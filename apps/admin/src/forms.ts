import type { Drop, Product, ProductWithSizes, Settings } from "@attakk/types";
import type {
  DropFormValues,
  NewSizeValues,
  ProductFormValues,
  SettingsFormValues,
  SizeRowValues,
} from "./views.js";

// Translating between a submitted form and the domain, in one place. Every
// write screen does the same four things — read the submitted fields as the
// shared zod schema expects them, read them back as strings so a reject can
// re-render exactly what was typed, turn zod issues into a message per field,
// and turn the API's refusal code into one the form can show — and each entity
// spells all four out for its own fields. Routing, the API calls and the
// per-screen re-render stay in app.ts, which is what those routes are; this is
// the policy they were burying.

// ------------------------------------------------------------- shared

// A parsed form body: hono's parseBody yields string values (and File for a file
// input). Shared by the product and drop form parsers, so named for neither.
export type FormBody = Record<string, string | File>;

export function formStr(value: string | File | undefined): string {
  return typeof value === "string" ? value : "";
}

// A form value bound for a zod number field: a numeric string becomes a number,
// a blank one becomes undefined (so a required field is rejected and an optional
// one takes its default), and anything else is passed through unchanged so zod
// rejects it with a type error rather than the route silently coercing it.
export function formNum(value: string | File | undefined): unknown {
  const s = formStr(value).trim();
  if (s === "") return undefined;
  const n = Number(s);
  return Number.isNaN(n) ? s : n;
}

// Zod issues to a per-field message, first message per field wins. Generic over the
// form's field set (the product and drop forms both use it): only issues whose path
// names one of `fields` are mapped, so an issue on a field the map's type does not
// carry — the create schema's drop_id, surfaced separately as dropError — is skipped
// rather than smuggled in.
export function fieldErrors<T extends string>(
  fields: readonly T[],
  issues: readonly { path: PropertyKey[]; message: string }[],
): Partial<Record<T, string>> {
  const out: Partial<Record<T, string>> = {};
  for (const issue of issues) {
    const key = issue.path[0];
    if (
      typeof key === "string" &&
      (fields as readonly string[]).includes(key) &&
      !(key in out)
    ) {
      out[key as T] = issue.message;
    }
  }
  return out;
}

// The status a refused write comes back as. apiWrite folds exactly these four
// into a conflict; anything else is already the service or not-found page.
export type ConflictStatus = 400 | 409 | 413 | 422;

export interface ConflictOutcome {
  status: ConflictStatus;
  message: string;
}

// What each refusal the API can answer a write with means to a person, and the
// status the screen echoes it back as. One table because it is one decision:
// it used to be taken at every write site, which is how a taken slug came to be
// answered 409 in four places and an oversized upload 413 in a fifth, each
// deriving it again from the code beside its own message.
//
// Which field a message belongs beside stays with the caller — the screen knows
// its own form, and the same slug_taken reads on the slug of a product and of a
// drop.
const CONFLICTS: Record<string, ConflictOutcome> = {
  slug_taken: { status: 409, message: "That slug is already in use." },
  drop_not_found: { status: 422, message: "That drop no longer exists." },
  has_orders: {
    status: 409,
    message:
      "This product has orders and can't be deleted. Set its status to hidden instead.",
  },
  size_in_use: {
    status: 409,
    message:
      "A size an order references can't be removed — hide the product instead.",
  },
  unknown_size: {
    status: 422,
    message: "One of those sizes no longer exists. Reload and try again.",
  },
  too_large: { status: 413, message: "That image is too large." },
  no_file: { status: 400, message: "Choose an image file to upload." },
  alt_too_long: { status: 400, message: "The alt text is too long." },
  invalid_upload: {
    status: 400,
    message: "That file could not be read as an image.",
  },
  unreadable: {
    status: 400,
    message: "That file could not be read as an image.",
  },
  username_taken: { status: 409, message: "That username is already taken." },
  last_admin: {
    status: 409,
    message:
      "That is the last active admin — deactivating it would lock everyone out.",
  },
};

// A refusal as its screen should show it. The fallback is the screen's own way
// of saying it has never seen this code — "The sizes were refused (…)" — and
// carries the status that screen answers an unrecognised refusal with, which is
// the one thing here that is genuinely per-screen.
export function conflictOutcome(
  code: string,
  fallback: ConflictOutcome,
): ConflictOutcome {
  return CONFLICTS[code] ?? fallback;
}

// ----------------------------------------------------------- products

export const PRODUCT_FIELDS = [
  "slug",
  "name",
  "description",
  "price_rappen",
  "fit",
  "fit_url",
  "min_orders",
  "status",
  "sort",
] as const;

// The submitted fields as productInput expects them (numbers parsed), for the zod
// check, and — separately — as strings, to echo back into the form on a reject.
export function productInputFromForm(form: FormBody): Record<string, unknown> {
  return {
    slug: formStr(form.slug),
    name: formStr(form.name),
    description: formStr(form.description),
    price_rappen: formNum(form.price_rappen),
    fit: formStr(form.fit),
    fit_url: formStr(form.fit_url),
    min_orders: formNum(form.min_orders),
    status: formStr(form.status),
    sort: formNum(form.sort),
  };
}

// The create body: the shared fields plus the drop to create into.
export function productCreateInputFromForm(
  form: FormBody,
): Record<string, unknown> {
  return { ...productInputFromForm(form), drop_id: formNum(form.drop_id) };
}

export function productFormValues(form: FormBody): ProductFormValues {
  return Object.fromEntries(
    PRODUCT_FIELDS.map((f) => [f, formStr(form[f])]),
  ) as ProductFormValues;
}

// A blank set of field values for a fresh create form, with the sensible defaults
// the schema also carries (a draft, one order, sort 0).
export function blankProductValues(): ProductFormValues {
  return {
    slug: "",
    name: "",
    description: "",
    price_rappen: "",
    fit: "",
    fit_url: "",
    min_orders: "1",
    status: "draft",
    sort: "0",
  };
}

export function productValues(product: Product): ProductFormValues {
  return {
    slug: product.slug,
    name: product.name,
    description: product.description,
    price_rappen: String(product.price_rappen),
    fit: product.fit,
    fit_url: product.fit_url,
    min_orders: String(product.min_orders),
    status: product.status,
    sort: String(product.sort),
  };
}

// -------------------------------------------------------------- sizes

// How many blank rows the size editor offers for adding new sizes. A saved size
// becomes an existing row next load, so a handful is enough without client JS.
export const NEW_SIZE_ROWS = 3;

// The size editor's rows for a stored product: each size as an existing row, plus
// the blank rows for adding more.
export function sizeStateFromProduct(product: ProductWithSizes): {
  existing: SizeRowValues[];
  fresh: NewSizeValues[];
} {
  return {
    existing: product.sizes.map((s) => ({
      id: String(s.id),
      label: s.label,
      sort: String(s.sort),
      remove: false,
    })),
    fresh: Array.from({ length: NEW_SIZE_ROWS }, () => ({
      label: "",
      sort: "",
    })),
  };
}

// Read the size editor back: the desired size list for productSizesInput (kept
// existing rows plus non-blank new rows) and the rows as submitted, so a reject
// re-renders exactly what was typed. A removed row drops out of the desired list;
// a blank new row is ignored.
export function sizesFromForm(form: FormBody): {
  sizes: unknown;
  state: { existing: SizeRowValues[]; fresh: NewSizeValues[] };
} {
  const existingCount = Number(formStr(form.existing_count)) || 0;
  const newCount = Number(formStr(form.new_count)) || 0;
  const existing: SizeRowValues[] = [];
  const fresh: NewSizeValues[] = [];
  const sizes: unknown[] = [];

  for (let i = 0; i < existingCount; i++) {
    const id = formStr(form[`id_${i}`]);
    const label = formStr(form[`label_${i}`]);
    const sort = formStr(form[`sort_${i}`]);
    const remove = formStr(form[`remove_${i}`]) !== "";
    existing.push({ id, label, sort, remove });
    if (!remove) sizes.push({ id: Number(id), label, sort: formNum(sort) });
  }
  for (let j = 0; j < newCount; j++) {
    const label = formStr(form[`new_label_${j}`]);
    const sort = formStr(form[`new_sort_${j}`]);
    fresh.push({ label, sort });
    if (label.trim() !== "") sizes.push({ label, sort: formNum(sort) });
  }
  return { sizes: { sizes }, state: { existing, fresh } };
}

// -------------------------------------------------------------- drops

export const DROP_FIELDS = [
  "slug",
  "name",
  "year",
  "no",
  "status",
  "sort",
  "tagline",
  "body",
  "note",
  "color_primary",
  "color_secondary",
  "color_accent",
  "color_text",
  "display_font",
  "theme_base",
] as const;

// The submitted fields as dropInput expects them (numbers parsed), for the zod
// check. Create and edit share one shape — a drop has no parent to name.
export function dropInputFromForm(form: FormBody): Record<string, unknown> {
  return {
    slug: formStr(form.slug),
    name: formStr(form.name),
    year: formNum(form.year),
    no: formNum(form.no),
    status: formStr(form.status),
    sort: formNum(form.sort),
    tagline: formStr(form.tagline),
    body: formStr(form.body),
    note: formStr(form.note),
    color_primary: formStr(form.color_primary),
    color_secondary: formStr(form.color_secondary),
    color_accent: formStr(form.color_accent),
    color_text: formStr(form.color_text),
    display_font: formStr(form.display_font),
    theme_base: formStr(form.theme_base),
  };
}

// The submitted values as strings, to echo back into the form on a reject.
export function dropFormValues(form: FormBody): DropFormValues {
  return Object.fromEntries(
    DROP_FIELDS.map((f) => [f, formStr(form[f])]),
  ) as DropFormValues;
}

export function dropValues(drop: Drop): DropFormValues {
  return {
    slug: drop.slug,
    name: drop.name,
    year: String(drop.year),
    no: String(drop.no),
    status: drop.status,
    sort: String(drop.sort),
    tagline: drop.tagline,
    body: drop.body,
    note: drop.note,
    color_primary: drop.color_primary,
    color_secondary: drop.color_secondary,
    color_accent: drop.color_accent,
    color_text: drop.color_text,
    display_font: drop.display_font,
    theme_base: drop.theme_base,
  };
}

// A blank set of field values for a fresh create form, with the defaults the schema
// also carries (a draft, sort 0) plus the shop's default font and base and the
// current year, so most creates only fill in a name, slug and number.
export function blankDropValues(): DropFormValues {
  return {
    slug: "",
    name: "",
    year: String(new Date().getFullYear()),
    no: "",
    status: "draft",
    sort: "0",
    tagline: "",
    body: "",
    note: "",
    color_primary: "",
    color_secondary: "",
    color_accent: "",
    color_text: "",
    display_font: "Antonio",
    theme_base: "light",
  };
}

// ----------------------------------------------------------- settings

export const SETTINGS_TEXT_FIELDS = [
  "creditor_name",
  "creditor_address",
  "creditor_building_number",
  "creditor_zip",
  "creditor_city",
  "creditor_country",
  "creditor_account",
  "notify_email",
] as const;

// The submitted settings as settingsInput expects them: the text fields as-is
// (it trims and normalises them itself) and shop_open as the boolean the checkbox
// stands for — present (any value) is open, absent is closed.
export function settingsInputFromForm(form: FormBody): Record<string, unknown> {
  const out: Record<string, unknown> = { shop_open: "shop_open" in form };
  for (const f of SETTINGS_TEXT_FIELDS) out[f] = formStr(form[f]);
  return out;
}

// The submitted text values as strings, to echo back into the form on a reject.
export function settingsFormValues(form: FormBody): SettingsFormValues {
  return Object.fromEntries(
    SETTINGS_TEXT_FIELDS.map((f) => [f, formStr(form[f])]),
  ) as SettingsFormValues;
}

export function settingsValues(s: Settings): SettingsFormValues {
  return Object.fromEntries(
    SETTINGS_TEXT_FIELDS.map((f) => [f, s[f]]),
  ) as SettingsFormValues;
}

// The shared zod's refine codes as a message beside the field. A blank value is
// always accepted, so these only ever fire on a non-blank one that is wrong.
export const SETTINGS_ERROR_MESSAGES: Record<string, string> = {
  invalid_iban:
    "That IBAN is not valid — check for a typo, and note a QR-IBAN is not accepted.",
  invalid_email: "Enter a valid email address, or leave it blank.",
  invalid_country: "The country must be CH, or blank.",
};

// fieldErrors keyed to the settings fields, then the known refine codes swapped
// for a readable message; anything else (a length cap) keeps zod's own text.
export function settingsErrors(
  issues: readonly { path: PropertyKey[]; message: string }[],
): Partial<Record<keyof SettingsFormValues, string>> {
  const errors = fieldErrors(SETTINGS_TEXT_FIELDS, issues);
  for (const key of Object.keys(errors) as (keyof SettingsFormValues)[]) {
    const code = errors[key];
    if (code && code in SETTINGS_ERROR_MESSAGES) {
      errors[key] = SETTINGS_ERROR_MESSAGES[code];
    }
  }
  return errors;
}

// -------------------------------------------------------------- users

export const ADMIN_USER_FIELDS = ["username", "password"] as const;

import assert from "node:assert/strict";
import { test } from "node:test";
import { productInput, productSizesInput, settingsInput } from "@attakk/types";
import {
  conflictOutcome,
  DROP_FIELDS,
  dropInputFromForm,
  fieldErrors,
  formNum,
  formStr,
  PRODUCT_FIELDS,
  productFormValues,
  productInputFromForm,
  settingsErrors,
  settingsInputFromForm,
  sizesFromForm,
} from "./forms.js";

const fallback = {
  status: 400,
  message: "The change was refused (brand_new_code).",
} as const;

// The helpers a write screen leans on, reachable on their own now that they are
// not buried in the route module. The routes themselves are covered end to end
// in routes.test.ts; this is the translation those routes hand the schema.

test("a blank number field is left undefined so the schema decides", () => {
  // Blank means "not submitted": a required field is then rejected by zod and an
  // optional one takes its default, instead of the route coercing a silent 0.
  assert.equal(formNum(""), undefined);
  assert.equal(formNum("   "), undefined);
  assert.equal(formNum(undefined), undefined);
  assert.equal(formNum(new File([], "x")), undefined);
});

test("a numeric field is a number, and anything else survives for zod to refuse", () => {
  assert.equal(formNum("9500"), 9500);
  assert.equal(formNum(" 42 "), 42);
  assert.equal(formNum("0"), 0);
  assert.equal(formNum("-3"), -3);
  // Not silently coerced to NaN or 0 — zod sees the string and says so.
  assert.equal(formNum("nine"), "nine");
  assert.equal(formNum("9,500"), "9,500");
});

test("a file in a text field reads as blank rather than [object File]", () => {
  assert.equal(formStr(new File([], "photo.jpg")), "");
  assert.equal(formStr(undefined), "");
  assert.equal(formStr("kept"), "kept");
});

test("the product form parses into what its schema accepts", () => {
  const form = {
    slug: "redline-jersey",
    name: "Redline Jersey",
    description: "",
    price_rappen: "9500",
    fit: "",
    fit_url: "",
    min_orders: "1",
    status: "live",
    sort: "0",
  };
  const parsed = productInput.safeParse(productInputFromForm(form));
  assert.equal(parsed.success, true);
  assert.equal(parsed.data?.price_rappen, 9500);
});

test("only issues naming a field of this form are shown on it", () => {
  const issues = [
    { path: ["price_rappen"], message: "too small" },
    { path: ["price_rappen"], message: "a second complaint" },
    { path: ["drop_id"], message: "surfaced elsewhere, not on a field" },
    { path: [], message: "an issue on the object itself" },
  ];
  assert.deepEqual(fieldErrors(PRODUCT_FIELDS, issues), {
    // The first message per field wins; drop_id is not a field of this map.
    price_rappen: "too small",
  });
  assert.deepEqual(fieldErrors(DROP_FIELDS, issues), {});
});

test("submitted values are echoed back as typed, valid or not", () => {
  const values = productFormValues({
    slug: "redline jersey",
    price_rappen: "nine",
    name: "Kept",
    photo: new File([], "x.jpg"),
  });
  assert.equal(values.slug, "redline jersey");
  assert.equal(values.price_rappen, "nine");
  assert.equal(values.name, "Kept");
  // Every field of the form is present, so no input renders as undefined.
  assert.deepEqual(Object.keys(values).sort(), [...PRODUCT_FIELDS].sort());
});

test("a refusal carries the status it is answered with, wherever it is raised", () => {
  // The same code means the same thing and the same status on every screen —
  // the decision each write site used to take for itself.
  assert.deepEqual(conflictOutcome("slug_taken", fallback), {
    status: 409,
    message: "That slug is already in use.",
  });
  assert.equal(conflictOutcome("too_large", fallback).status, 413);
  assert.equal(conflictOutcome("unknown_size", fallback).status, 422);
  assert.equal(conflictOutcome("last_admin", fallback).status, 409);
});

test("a code the admin has never seen is said in the screen's own words", () => {
  assert.deepEqual(conflictOutcome("brand_new_code", fallback), fallback);
});

test("the drop form's numbers are parsed and its colours passed through", () => {
  const input = dropInputFromForm({
    slug: "redline",
    name: "Redline",
    year: "2026",
    no: "1",
    status: "draft",
    sort: "0",
    tagline: "",
    body: "",
    note: "",
    color_primary: "#ff0000",
    color_secondary: "",
    color_accent: "",
    color_text: "",
    display_font: "Antonio",
    theme_base: "light",
  });
  assert.equal(input.year, 2026);
  assert.equal(input.no, 1);
  assert.equal(input.color_primary, "#ff0000");
});

test("the size editor reads back kept rows, dropping removals and blanks", () => {
  const { sizes, state } = sizesFromForm({
    existing_count: "2",
    id_0: "100",
    label_0: "S",
    sort_0: "0",
    id_1: "101",
    label_1: "M",
    sort_1: "1",
    remove_1: "on",
    new_count: "3",
    new_label_0: "L",
    new_sort_0: "2",
    new_label_1: "   ",
    new_sort_1: "",
    new_label_2: "",
    new_sort_2: "",
  });

  const parsed = productSizesInput.safeParse(sizes);
  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.data?.sizes, [
    { id: 100, label: "S", sort: 0 },
    { label: "L", sort: 2 },
  ]);

  // The rows come back exactly as submitted, removal ticked, so a reject
  // re-renders the editor the way it was left.
  assert.equal(state.existing.length, 2);
  assert.equal(state.existing[1].remove, true);
  assert.equal(state.fresh.length, 3);
  assert.equal(state.fresh[0].label, "L");
});

test("a size editor submitted with nothing in it asks for no sizes", () => {
  const { sizes, state } = sizesFromForm({});
  assert.deepEqual(sizes, { sizes: [] });
  assert.deepEqual(state, { existing: [], fresh: [] });
});

test("the shop_open checkbox stands for a boolean, absent meaning closed", () => {
  assert.equal(settingsInputFromForm({ shop_open: "on" }).shop_open, true);
  assert.equal(settingsInputFromForm({}).shop_open, false);
});

test("a refine code becomes a sentence, other messages keep zod's text", () => {
  const parsed = settingsInput.safeParse(
    settingsInputFromForm({ creditor_account: "not-an-iban" }),
  );
  assert.equal(parsed.success, false);
  const errors = settingsErrors(parsed.error?.issues ?? []);
  assert.match(errors.creditor_account ?? "", /IBAN/);
  assert.doesNotMatch(errors.creditor_account ?? "", /invalid_iban/);
});

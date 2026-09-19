import {
  MAX_PASSWORD_LEN,
  MAX_USERNAME_LEN,
  MIN_PASSWORD_LEN,
} from "@attakk/types";
import { hashPassword } from "../password.js";
import { createAdminUser } from "../repositories/admin-users.js";

// Creates an admin user from the command line — the only way the first admin is
// made, since there is no signup screen. After this one, an existing admin adds
// the rest from the panel. Run on the server where the database lives:
//
//   pnpm --filter @attakk/api seed-user <username>   (dev, via tsx)
//   node dist/cli/seed-user.js <username>            (in the container)
//
// The password is typed at a hidden prompt, so it never lands in shell history
// or the process list. Importing the repository (and through it ./db) opens and
// migrates the same database the API serves.

// The control bytes the hidden prompt reacts to, built from char codes so no
// unprintable literal has to live in the source: end-of-line, Ctrl-C, Ctrl-D
// and the two bytes a terminal may send for backspace.
const ENTER = ["\r", "\n"];
const CTRL_C = String.fromCharCode(3);
const CTRL_D = String.fromCharCode(4);
const BACKSPACE = [String.fromCharCode(127), String.fromCharCode(8)];

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

// The piped-input fallback reads visibly. Piped input is finite and arrives in
// one burst, so line-at-a-time reads race — the second line is delivered and
// dropped before a second reader is listening. Draining all of stdin once and
// serving prompts from the buffered lines sidesteps that entirely.
let pipedLines: string[] | undefined;
async function promptPiped(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  if (!pipedLines) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    pipedLines = Buffer.concat(chunks).toString("utf8").split(/\r?\n/);
  }
  const line = pipedLines.shift() ?? "";
  process.stdout.write("\n");
  return line;
}

// Characters a prompt read past its terminating newline, held for the next
// prompt. A single raw-mode chunk can carry the end of one line and the start of
// the next — a paste of "password\nconfirm\n" arrives at once — so dropping the
// tail would truncate the next read or hang waiting for input already consumed.
let ttyCarry = "";

// Reads a line with the terminal echo off, so a typed password leaves no trace
// on screen. When stdin is not a TTY (piped input) raw mode is unavailable, so
// it falls back to a visible read — there the caller has chosen not to hide it.
function promptHidden(prompt: string): Promise<string> {
  const { stdin, stdout } = process;

  if (!stdin.isTTY) return promptPiped(prompt);

  return new Promise((resolve) => {
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";

    // Fold a chunk into `value`; returns true once the line ends, stashing
    // anything after the newline in ttyCarry for the next prompt to pick up.
    const consume = (chunk: string): boolean => {
      for (let i = 0; i < chunk.length; i++) {
        const char = chunk[i];
        if (ENTER.includes(char) || char === CTRL_D) {
          ttyCarry = chunk.slice(i + 1);
          return true;
        }
        if (char === CTRL_C) {
          // Leave the terminal as we found it before bailing out.
          stdin.setRawMode(false);
          stdout.write("\n");
          process.exit(130);
        }
        if (BACKSPACE.includes(char)) value = value.slice(0, -1);
        else value += char;
      }
      return false;
    };

    const finish = (): void => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      stdout.write("\n");
      resolve(value);
    };

    const onData = (chunk: string): void => {
      if (consume(chunk)) finish();
    };

    // Drain any tail the previous prompt read past its newline before listening,
    // so a pasted multi-line input is not lost between the two prompts.
    if (ttyCarry) {
      const carried = ttyCarry;
      ttyCarry = "";
      if (consume(carried)) {
        finish();
        return;
      }
    }
    stdin.on("data", onData);
  });
}

const username = process.argv[2]?.trim();
if (!username) fail("usage: seed-user <username>");
// Refuse a username the login schema would later reject, or the user could be
// created and then never able to sign in.
if (username.length > MAX_USERNAME_LEN) {
  fail(`username must be at most ${MAX_USERNAME_LEN} characters`);
}

const password = await promptHidden(`Password for ${username}: `);
// Both bounds, for the same reason: a floor for a sane first password, and the
// login schema's ceiling so what is set here is a password login will accept.
if (password.length < MIN_PASSWORD_LEN || password.length > MAX_PASSWORD_LEN) {
  fail(
    `password must be between ${MIN_PASSWORD_LEN} and ${MAX_PASSWORD_LEN} characters`,
  );
}
if ((await promptHidden("Confirm password: ")) !== password) {
  fail("passwords did not match");
}

try {
  const user = createAdminUser({
    username,
    password_hash: hashPassword(password),
  });
  console.log(`created admin user ${user.username} (#${user.id})`);
  process.exit(0);
} catch (err) {
  // username is UNIQUE; a duplicate is the one error worth naming plainly rather
  // than dumping a SqliteError at whoever is setting the server up.
  if (err instanceof Error && err.message.includes("UNIQUE")) {
    fail(`an admin user named ${username} already exists`);
  }
  throw err;
}

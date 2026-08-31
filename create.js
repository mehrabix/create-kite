#!/usr/bin/env node

import { promises as fs, readFileSync } from "fs";
import path from "path";
import { execSync } from "child_process";
import readline from "readline";

const TEMPLATES_DIR = path.join(import.meta.dirname, "templates");
const PM_INSTALL = {
  npm: "npm install",
  pnpm: "pnpm install",
  yarn: "yarn",
  bun: "bun install",
};

const col = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

// Prompts: use readline for interactive TTY sessions. When stdin is piped or
// redirected (CI, tests), read all lines up front and serve them from a queue —
// this avoids readline's flaky piped-stdin behaviour (stalls / use-after-close).
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

let pipedLines = null;
function nextPipedLine() {
  if (pipedLines === null) {
    const source = readFileSync(0, "utf-8");
    pipedLines = source.split(/\r?\n/);
  }
  return pipedLines.length ? pipedLines.shift() : "";
}

const isTTY = Boolean(process.stdin.isTTY);
function ask(question) {
  if (isTTY) {
    return new Promise((resolve) => rl.question(question, resolve));
  }
  process.stdout.write(question);
  return Promise.resolve(nextPipedLine());
}

let projectName = null;
const flags = parseFlags(process.argv.slice(2));

// First non-flag arg is the project name (flags may come before or after)
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith("-") && a !== "--yes") {
    projectName = a;
    break;
  }
}

(async () => {
  console.log(
    `${col.cyan}🪁 Welcome to create-kite — Shopify Liquid theme scaffold!${col.reset}`
  );

  if (flags.yes) {
    projectName = projectName || "my-theme";
  } else {
    if (!projectName) projectName = await promptProjectName();
    projectName = await checkFolderExists(projectName);
  }

  const answers = flags.yes
    ? {
        template: "minimal",
        pm: detectPackageManager(),
        tailwind: true,
        preflight: false,
        js: "none",
        prettier: false,
        check: "recommended",
        vscode: false,
        ci: "none",
        hooks: false,
        deploy: false,
        store: flags.store || "",
        git: true,
        install: true,
      }
    : {
        template: await promptTemplate(),
        pm: await promptPackageManager(),
        tailwind: await promptConfirm("Include Tailwind CSS v4?", true),
        preflight: false,
        js: await promptChoice("JavaScript layer", ["none", "alpine", "vanilla-ts"]),
        prettier: await promptConfirm("Add Prettier + Liquid plugin?", true),
        check: await promptChoice("theme-check preset", ["recommended", "strict"]),
        vscode: await promptConfirm("Add VS Code workspace config?", false),
        ci: await promptChoice("GitHub Actions CI", ["none", "check", "check+deploy"]),
        hooks: await promptConfirm("Add git hooks (husky + lint-staged)?", false),
        store: await promptOptional("Store URL? (e.g. my-store.myshopify.com) [skip]", ""),
        git: await promptConfirm("Initialize a git repository?", true),
        install: await promptConfirm("Install dependencies now?", true),
      };

  // --tailwind/--no-tailwind, --preflight override prompts
  if (flags.tailwind !== undefined) answers.tailwind = flags.tailwind;
  if (flags.preflight) answers.preflight = true;
  if (flags.js) answers.js = flags.js;
  if (flags.prettier !== undefined) answers.prettier = flags.prettier;
  if (flags.check) answers.check = flags.check;
  if (flags.vscode !== undefined) answers.vscode = flags.vscode;
  if (flags.ci) answers.ci = flags.ci;
  if (flags.hooks !== undefined) answers.hooks = flags.hooks;
  if (flags.deploy !== undefined) answers.deploy = flags.deploy;
  if (flags.template) answers.template = flags.template;
  if (flags.pm) answers.pm = flags.pm;
  if (flags.store) answers.store = flags.store;
  if (flags.git !== undefined) answers.git = flags.git;
  if (flags.install !== undefined) answers.install = flags.install;

  const targetDir = path.isAbsolute(projectName)
    ? projectName
    : path.join(process.cwd(), projectName);

  try {
    await fs.mkdir(targetDir, { recursive: true });

    // minimal is the base; full layers on top of it
    console.log(`${col.cyan}⏳ Copying template "${answers.template}"...${col.reset}`);
    await copyDir(path.join(TEMPLATES_DIR, "minimal"), targetDir);
    if (answers.template !== "minimal") {
      await copyDir(path.join(TEMPLATES_DIR, answers.template), targetDir);
    }

    if (answers.tailwind) {
      console.log(`${col.cyan}⚡ Setting up Tailwind CSS v4...${col.reset}`);
      await writeTailwind(targetDir, answers);
      await appendThemeStylesheet(targetDir, answers);
    }

    console.log(`${col.cyan}📝 Writing project files...${col.reset}`);
    await writeRootFiles(targetDir, answers, projectName);
    await writePackageJson(targetDir, answers, projectName);
    await writeReadme(targetDir, answers, projectName);
    if (answers.js !== "none") await setupJsLayer(targetDir, answers, projectName);
    if (answers.prettier) await setupPrettier(targetDir);
    if (answers.vscode) await setupVscode(targetDir);
    if (answers.ci !== "none") await setupCi(targetDir, answers);
    if (answers.hooks) await setupHooks(targetDir, answers);

    if (answers.install) {
      console.log(`${col.cyan}📦 Installing dependencies (${answers.pm})...${col.reset}`);
      const nm = path.join(targetDir, "node_modules");
      try {
        execSync(PM_INSTALL[answers.pm], { cwd: targetDir, stdio: "inherit" });
      } catch (e) {
        // pnpm 11 exits 1 on ignored build scripts even when node_modules is fine
        // (known quirk we hit with @parcel/watcher). Verify install actually worked.
        const nmOk = await fs
          .access(nm)
          .then(() => true)
          .catch(() => false);
        if (answers.pm === "pnpm" && nmOk) {
          console.log(
            `${col.yellow}⚠️ pnpm warned about a build script — dependencies installed OK.${col.reset}`
          );
        } else if (answers.pm === "npm") {
          // npm 11 can silently skip install; retry with npm ci
          console.log(`${col.yellow}⚠️ install incomplete — retrying with npm ci...${col.reset}`);
          execSync("npm ci", { cwd: targetDir, stdio: "inherit" });
        } else {
          throw e;
        }
      }
      try {
        await fs.access(nm);
      } catch {
        throw new Error(
          `Dependencies failed to install (no node_modules). Run "${answers.pm} install" manually in ./${projectName}`
        );
      }
    }

    if (answers.tailwind && answers.install) {
      console.log(`${col.cyan}🎨 Building Tailwind CSS...${col.reset}`);
      const bin = path.join(targetDir, "node_modules", ".bin", "tailwindcss");
      execSync(
        `"${bin}" -i ./src/tailwind-input.css -o ./assets/tailwind.css --minify`,
        { cwd: targetDir, stdio: "inherit" }
      );
    } else if (answers.tailwind && !answers.install) {
      console.log(
        `${col.yellow}⚠️ Skipping Tailwind build (--no-install). Run "pnpm install && pnpm css:build" when ready.${col.reset}`
      );
    }

    if (answers.js !== "none" && answers.install) {
      console.log(`${col.cyan}📦 Building JavaScript (esbuild)...${col.reset}`);
      const bin = path.join(targetDir, "node_modules", ".bin", "esbuild");
      const entry =
        answers.js === "alpine" ? "src/js/index.js" : "src/js/index.ts";
      try {
        execSync(
          `"${bin}" ${entry} --bundle --outfile=assets/theme.js --minify`,
          { cwd: targetDir, stdio: "inherit" }
        );
      } catch (e) {
        console.log(
          `${col.yellow}⚠️ JS build failed — run "${answers.pm} run js:build" after install.${col.reset}`
        );
      }
    } else if (answers.js !== "none" && !answers.install) {
      console.log(
        `${col.yellow}⚠️ Skipping JS build (--no-install). Run "pnpm install && pnpm run js:build" when ready.${col.reset}`
      );
    }
    if (answers.js !== "none") await wireThemeJs(targetDir, answers);

    if (answers.git) {
      console.log(`${col.cyan}🌱 Initializing git...${col.reset}`);
      try {
        execSync("git init -b main", { cwd: targetDir, stdio: "inherit" });
        // Use a local fallback identity if none is configured globally
        let name = "";
        let email = "";
        try {
          name = execSync("git config user.name", { cwd: targetDir })
            .toString()
            .trim();
        } catch {}
        try {
          email = execSync("git config user.email", { cwd: targetDir })
            .toString()
            .trim();
        } catch {}
        const ident = [];
        if (!name) ident.push('-c user.name="Kite User"');
        if (!email) ident.push('-c user.email="kite@users.noreply.github.com"');
        execSync("git add -A", { cwd: targetDir, stdio: "inherit" });
        execSync(
          `git ${ident.join(" ")} commit -m "Initial commit via create-kite"`,
          { cwd: targetDir, stdio: "inherit" }
        );
      } catch (e) {
        console.log(
          `${col.yellow}⚠️ Git commit skipped — ${e.message.split("\n")[0]}${col.reset}`
        );
      }
    }

    done(answers, targetDir);
  } catch (err) {
    console.error(`${col.red}❌ Error: ${err.message}${col.reset}`);
    process.exit(1);
  }
})();

/* ---------- prompts (pure readline, like litpack) ---------- */

function promptProjectName() {
  return new Promise(async (resolve) => {
    for (;;) {
      const name = (await ask(`${col.green}📛 Project name: ${col.reset}`)).trim();
      if (name && /^[a-z0-9-]+$/i.test(name)) {
        console.log(`${col.green}✔ Project name:${col.reset} ${name}`);
        resolve(name);
        return;
      }
      console.log(`${col.yellow}⚠️ Use lowercase letters, numbers, and dashes.${col.reset}`);
    }
  });
}

async function checkFolderExists(name) {
  const targetDir = path.isAbsolute(name) ? name : path.join(process.cwd(), name);
  try {
    const stats = await fs.stat(targetDir);
    if (stats.isDirectory()) {
      console.log(`${col.yellow}🚨 Folder "${name}" already exists.${col.reset}`);
      return promptProjectName();
    }
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  return name;
}

function promptTemplate() {
  return promptChoice("Template", ["minimal", "full"]);
}

function promptPackageManager() {
  return promptChoice("Package manager", ["pnpm", "npm", "bun", "yarn"]);
}

async function promptConfirm(message, def) {
  const suffix = def ? " (Y/n)" : " (y/N)";
  for (;;) {
    const answer = (await ask(`${col.green}❓ ${message}${suffix} ${col.reset}`)).trim().toLowerCase();
    let result;
    if (answer === "y" || answer === "yes") result = true;
    else if (answer === "n" || answer === "no") result = false;
    else if (answer === "") result = def;
    else {
      console.log(`${col.yellow}⚠️ Please answer y or n.${col.reset}`);
      continue;
    }
    console.log(`${col.green}✔ ${message}:${col.reset} ${result ? "Yes" : "No"}`);
    return result;
  }
}

async function promptOptional(message) {
  const value = (await ask(`${col.green}❓ ${message} ${col.reset}`)).trim();
  if (value) console.log(`${col.green}✔ ${message}:${col.reset} ${value}`);
  return value;
}

async function promptChoice(title, choices) {
  // Numbered menu — simple and robust: no raw mode, no escape codes, works
  // in any terminal (TTY, piped, CI). Type a number (or the option name).
  for (;;) {
    const list = choices.map((c, i) => `${i + 1}) ${c}`).join(", ");
    const answer = (await ask(`${col.green}❓ ${title} (${list}) ${col.reset}`)).trim().toLowerCase();
    const byNumber = parseInt(answer, 10);
    if (!Number.isNaN(byNumber) && byNumber >= 1 && byNumber <= choices.length) {
      const choice = choices[byNumber - 1];
      console.log(`${col.green}✔ ${title}:${col.reset} ${col.cyan}${choice}${col.reset}`);
      return choice;
    }
    const byName = choices.find((c) => c.toLowerCase() === answer);
    if (byName) {
      console.log(`${col.green}✔ ${title}:${col.reset} ${col.cyan}${byName}${col.reset}`);
      return byName;
    }
    console.log(`${col.yellow}⚠️ Please enter a number 1-${choices.length} or one of: ${choices.join(", ")}.${col.reset}`);
  }
}

/* ---------- file generation ---------- */

function detectPackageManager() {
  try {
    execSync("pnpm --version", { stdio: "ignore" });
    return "pnpm";
  } catch {}
  try {
    execSync("npm --version", { stdio: "ignore" });
    return "npm";
  } catch {}
  return "npm";
}

async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

function themeScripts(answers, projectName) {
  const baseDev =
    answers.store !== ""
      ? `shopify theme dev --store ${answers.store}`
      : "shopify theme dev";
  const storeFlag =
    answers.store !== "" ? ` --store ${answers.store}` : "";

  // Compose the `dev` command: shopify theme dev + css watch (if Tailwind) +
  // js watch (if a JS layer) all in ONE terminal via concurrently.
  const devCommands = [`"${baseDev}"`];
  const devNames = ["theme"];
  const devColors = ["cyan"];
  if (answers.tailwind) {
    devCommands.push(`"${answers.pm} run css:watch"`);
    devNames.push("css");
    devColors.push("green");
  }
  if (answers.js !== "none") {
    devCommands.push(`"${answers.pm} run js:watch"`);
    devNames.push("js");
    devColors.push("magenta");
  }
  const dev =
    devCommands.length > 1
      ? `concurrently -k -n ${devNames.join(",")} -c ${devColors.join(",")} ${devCommands.join(" ")}`
      : baseDev;

  const scripts = {
    dev,
    "dev:only": baseDev,
    "css:build":
      "tailwindcss -i ./src/tailwind-input.css -o ./assets/tailwind.css --minify",
    "css:watch":
      "tailwindcss -i ./src/tailwind-input.css -o ./assets/tailwind.css --minify --watch",
    check: "shopify theme check",
    list: `shopify theme list${storeFlag}`,
    pull: `shopify theme pull${storeFlag}`,
    push: `shopify theme push${storeFlag}`,
    deploy: `shopify theme push --unpublished --confirm${storeFlag}`,
    open: `shopify theme open${storeFlag}`,
  };
  if (answers.js !== "none") {
    const entry =
      answers.js === "alpine" ? "src/js/index.js" : "src/js/index.ts";
    scripts["js:build"] = `esbuild ${entry} --bundle --outfile=assets/theme.js --minify`;
    scripts["js:watch"] = `esbuild ${entry} --bundle --outfile=assets/theme.js --watch`;
  }
  if (answers.prettier) {
    scripts["format"] = "prettier --write .";
  }
  if (answers.hooks) {
    scripts["prepare"] = "husky";
  }
  return scripts;
}

async function writeTailwind(targetDir, answers) {
  const preflightImport = answers.preflight
    ? '@import "tailwindcss/preflight.css" layer(base);\n'
    : "";
  const input = `@layer theme, base, components, utilities;
@import "tailwindcss/theme.css" layer(theme);
${preflightImport}@import "tailwindcss/utilities.css" layer(utilities);

/* shadcn/ui-style token mapping — maps Tailwind color utilities to the CSS
   variables defined in snippets/css-variables.liquid, so classes like
   bg-primary, text-muted-foreground recolor from the theme editor. */

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);

  --radius-sm: calc(var(--radius) * 0.6);
  --radius-md: calc(var(--radius) * 0.8);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) * 1.4);
}

/* Scan Liquid files for utility classes */
@source "../layout";
@source "../sections";
@source "../snippets";
@source "../blocks";
@source "../templates";
`;
  await fs.mkdir(path.join(targetDir, "src"), { recursive: true });
  await fs.writeFile(path.join(targetDir, "src", "tailwind-input.css"), input);
}

async function appendThemeStylesheet(targetDir) {
  const themePath = path.join(targetDir, "layout", "theme.liquid");
  const theme = await fs.readFile(themePath, "utf-8");
  const marker = "{{ 'critical.css' | asset_url | stylesheet_tag: preload: true }}";
  const tailwindTag = `\n    {% # Tailwind CSS (compiled, see pnpm css:build) %}\n    {{ 'tailwind.css' | asset_url | stylesheet_tag }}`;
  if (!theme.includes("tailwind.css")) {
    await fs.writeFile(
      themePath,
      theme.replace(marker, marker + tailwindTag)
    );
  }
}

async function setupJsLayer(targetDir, answers, projectName) {
  const jsDir = path.join(targetDir, "src", "js");
  await fs.mkdir(jsDir, { recursive: true });
  const isTs = answers.js === "vanilla-ts";
  const entry = path.join(jsDir, isTs ? "index.ts" : "index.js");
  if (answers.js === "alpine") {
    await fs.writeFile(
      entry,
      `import Alpine from "alpinejs";

window.Alpine = Alpine;
Alpine.start();
`
    );
  } else {
    await fs.writeFile(
      entry,
      `// ${projectName} theme entrypoint — add your vanilla TypeScript here.
`
    );
  }
  if (isTs) {
    await fs.writeFile(
      path.join(targetDir, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "Bundler",
            strict: true,
            skipLibCheck: true,
            types: [],
          },
          include: ["src/js"],
        },
        null,
        2
      ) + "\n"
    );
  }
}

async function wireThemeJs(targetDir, answers) {
  // Only reference the built asset if it actually exists, so a scaffold with
  // --no-install (or a failed build) never 404s on assets/theme.js.
  const themePath = path.join(targetDir, "layout", "theme.liquid");
  const theme = await fs.readFile(themePath, "utf-8");
  if (theme.includes("theme.js")) return;
  const builtAsset = path.join(targetDir, "assets", "theme.js");
  try {
    await fs.access(builtAsset);
  } catch {
    console.log(
      `${col.yellow}⚠️ Skipping theme.js wiring (not built). Run "${answers.pm} run js:build" when ready.${col.reset}`
    );
    return;
  }
  await fs.writeFile(
    themePath,
    theme.replace(
      "</body>",
      `    <script src="{{ 'theme.js' | asset_url }}" defer></script>\n  </body>`
    )
  );
}

async function setupPrettier(targetDir) {
  await fs.writeFile(
    path.join(targetDir, ".prettierrc"),
    JSON.stringify(
      {
        plugins: ["@shopify/prettier-plugin-liquid"],
        overrides: [
          {
            files: "*.liquid",
            options: {
              parser: "liquid-html",
              singleQuote: true,
              tabWidth: 2,
            },
          },
        ],
      },
      null,
      2
    ) + "\n"
  );
  await fs.writeFile(
    path.join(targetDir, ".prettierignore"),
    `node_modules/
assets/*.css
assets/*.js
package-lock.json
pnpm-lock.yaml
`
  );
}

async function setupVscode(targetDir) {
  const vscodeDir = path.join(targetDir, ".vscode");
  await fs.mkdir(vscodeDir, { recursive: true });
  await fs.writeFile(
    path.join(vscodeDir, "extensions.json"),
    JSON.stringify(
      {
        recommendations: [
          "shopify.theme-check-vscode",
          "esbenp.prettier-vscode",
          "bradlc.vscode-tailwindcss",
        ],
      },
      null,
      2
    ) + "\n"
  );
  await fs.writeFile(
    path.join(vscodeDir, "settings.json"),
    JSON.stringify(
      {
        "editor.formatOnSave": true,
        "editor.defaultFormatter": "esbenp.prettier-vscode",
        "[liquid]": {
          "editor.defaultFormatter": "shopify.theme-check-vscode",
        },
        "tailwindCSS.experimental.classRegex": [
          "class=\"([^\"]*)\"",
          "class: '([^']*)'",
        ],
      },
      null,
      2
    ) + "\n"
  );
}

async function setupCi(targetDir, answers) {
  const ghDir = path.join(targetDir, ".github", "workflows");
  await fs.mkdir(ghDir, { recursive: true });
  const failLevel = answers.check === "strict" ? "error" : "warning";
  const deployJob =
    answers.ci === "check+deploy"
      ? `
  deploy:
    needs: theme-check
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Install Shopify CLI
        run: npm install -g @shopify/cli
      - name: Push theme (unpublished)
        env:
          SHOPIFY_CLI_THEME_TOKEN: \${{ secrets.SHOPIFY_CLI_THEME_TOKEN }}
          SHOPIFY_FLAG_STORE: \${{ secrets.SHOPIFY_STORE }}
        run: shopify theme push --unpublished --confirm
`
      : "";
  await fs.writeFile(
    path.join(ghDir, "theme-check.yml"),
    `name: Theme Check

on:
  push:
    branches: [main]
  pull_request:

jobs:
  theme-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Install Shopify CLI
        run: npm install -g @shopify/cli
      - name: Theme check
        run: shopify theme check --fail-level ${failLevel}
${deployJob}
`
  );
}

async function setupHooks(targetDir, answers) {
  // husky + lint-staged: run prettier (and theme-check) on pre-commit
  const huskyDir = path.join(targetDir, ".husky");
  await fs.mkdir(huskyDir, { recursive: true });
  await fs.writeFile(
    path.join(huskyDir, "pre-commit"),
    `npx lint-staged
`
  );
  const lintStaged = {
    "*.liquid": ["prettier --write"],
    "*.{css,js,ts,json,md}": ["prettier --write"],
  };
  if (answers.check === "strict") {
    lintStaged["*.liquid"] = ["prettier --write", "shopify theme check --fail-level error"];
  }
  await fs.writeFile(
    path.join(targetDir, ".lintstagedrc.json"),
    JSON.stringify(lintStaged, null, 2) + "\n"
  );
}

async function writeRootFiles(targetDir, answers, projectName) {
  const gitignore = `# OS generated files #
######################
.DS_Store
.DS_Store?
._*
.Spotlight-V100
.Trashes
ehthumbs.db
Thumbs.db
node_modules/

# Shopify CLI files
.shopify/

## Release files
release
*.zip
`;

  const shopifyignore = `# Ignore dev tooling from Shopify pushes
node_modules/
src/
package.json
pnpm-lock.yaml
package-lock.json
yarn.lock
bun.lockb
pnpm-workspace.yaml
`;

  const themeCheck =
    answers.check === "strict"
      ? "extends: theme-check:all\n"
      : "extends: theme-check:recommended\n";

  const editorconfig = `root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2
`;

  const pnpmWorkspace =
    answers.pm === "pnpm"
      ? "allowBuilds:\n  '@parcel/watcher': true\n  esbuild: true\n"
      : "";

  const files = {
    ".gitignore": gitignore,
    ".shopifyignore": shopifyignore,
    ".theme-check.yml": themeCheck,
    ".editorconfig": editorconfig,
  };
  if (pnpmWorkspace) files["pnpm-workspace.yaml"] = pnpmWorkspace;

  for (const [name, content] of Object.entries(files)) {
    await fs.writeFile(path.join(targetDir, name), content);
  }
}

async function writePackageJson(targetDir, answers, projectName) {
  // npm package names can't be paths — use the last path segment
  const pkgName = path.basename(projectName);
  const devDeps = {};
  if (answers.tailwind) {
    devDeps["@tailwindcss/cli"] = "^4.3.0";
    devDeps["tailwindcss"] = "^4.3.0";
    devDeps["concurrently"] = "^9.1.0";
  }
  if (answers.js === "alpine") {
    devDeps["esbuild"] = "^0.25.0";
    devDeps["alpinejs"] = "^3.14.0";
  }
  if (answers.js === "vanilla-ts") {
    devDeps["esbuild"] = "^0.25.0";
    devDeps["typescript"] = "^5.7.0";
  }
  if (answers.prettier) {
    devDeps["prettier"] = "^3.5.0";
    devDeps["@shopify/prettier-plugin-liquid"] = "^1.11.0";
  }
  if (answers.hooks) {
    devDeps["husky"] = "^9.1.0";
    devDeps["lint-staged"] = "^15.4.0";
  }
  const pkg = {
    name: pkgName,
    version: "0.1.0",
    private: true,
    description: `Shopify Liquid theme scaffolded with create-kite`,
    scripts: themeScripts(answers, projectName),
    devDependencies: devDeps,
  };
  await fs.writeFile(
    path.join(targetDir, "package.json"),
    JSON.stringify(pkg, null, 2) + "\n"
  );
}

async function writeReadme(targetDir, answers, projectName) {
  const readme = `# ${projectName}

Shopify Liquid theme scaffolded with **create-kite**.

## Getting started

\`\`\`bash
cd ${projectName}
pnpm install
pnpm dev${answers.tailwind ? "   # runs shopify theme dev + Tailwind watch together" : ""}
\`\`\`

${answers.store ? `Store: \`${answers.store}\`` : "Run \`shopify theme dev --store YOUR-STORE.myshopify.com\`"}

## Scripts

| Script | Purpose |
|--------|---------|
| \`dev\` | \`shopify theme dev\`${answers.tailwind ? " + Tailwind watch" : ""}${answers.js !== "none" ? " + JS watch" : ""} (one terminal)${answers.store ? ` (\`${answers.store}\`)` : ""} |
${answers.tailwind ? "| `dev:only` | Plain `shopify theme dev` without watchers |\n| `css:build` | Build Tailwind CSS to assets/tailwind.css |\n| `css:watch` | Rebuild Tailwind on file change |\n" : ""}${answers.js !== "none" ? "| `js:build` | Bundle JS to assets/theme.js |\n| `js:watch` | Rebuild JS on file change |\n" : ""}| \`check\` | Run theme-check |

## Stack

- Shopify Liquid (Online Store 2.0)
${answers.tailwind ? "- Tailwind CSS v4 (preflight " + (answers.preflight ? "on" : "off") + ")" : ""}

Scaffolded with [create-kite](https://github.com/mehrabix/create-kite).
`;
  await fs.writeFile(path.join(targetDir, "README.md"), readme);
}

function done(answers, targetDir) {
  if (isTTY) rl.close();
  if (flags.json) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          name: path.basename(targetDir),
          dir: targetDir,
          template: answers.template,
          packageManager: answers.pm,
          tailwind: answers.tailwind,
          preflight: answers.preflight,
          js: answers.js,
          prettier: answers.prettier,
          themeCheck: answers.check,
          vscode: answers.vscode,
          ci: answers.ci,
          hooks: answers.hooks,
          deploy: answers.deploy,
          store: answers.store,
          git: answers.git,
          installed: answers.install,
        },
        null,
        2
      )
    );
    return;
  }
  console.log(`${col.green}✅ Project ready in ./${path.basename(targetDir)}${col.reset}`);
  console.log(`${col.blue}Next steps:${col.reset}`);
  console.log(`  cd ${path.basename(targetDir)}`);
  if (answers.install) {
    console.log(`  ${answers.pm} run dev${answers.tailwind || answers.js !== "none" ? "   # shopify theme dev + watchers (one terminal)" : ""}`);
  } else {
    console.log(`  ${answers.pm} install`);
    console.log(`  ${answers.pm} run dev`);
  }
  if (answers.store) {
    console.log(`${col.green}🔗 Dev preview: shopify theme dev --store ${answers.store}${col.reset}`);
  }
}

/* ---------- flag parsing (pure node) ---------- */

function parseFlags(args) {
  const flags = {
    yes: false,
    tailwind: undefined,
    preflight: false,
    js: undefined,
    prettier: undefined,
    check: undefined,
    vscode: undefined,
    ci: undefined,
    hooks: undefined,
    deploy: undefined,
    json: false,
    template: undefined,
    pm: undefined,
    store: undefined,
    git: undefined,
    install: undefined,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--yes") flags.yes = true;
    else if (a === "--tailwind") flags.tailwind = true;
    else if (a === "--no-tailwind") flags.tailwind = false;
    else if (a === "--preflight") flags.preflight = true;
    else if (a === "--prettier") flags.prettier = true;
    else if (a === "--no-prettier") flags.prettier = false;
    else if (a === "--vscode") flags.vscode = true;
    else if (a === "--no-vscode") flags.vscode = false;
    else if (a === "--hooks") flags.hooks = true;
    else if (a === "--no-hooks") flags.hooks = false;
    else if (a === "--deploy") flags.deploy = true;
    else if (a === "--no-deploy") flags.deploy = false;
    else if (a === "--no-git") flags.git = false;
    else if (a === "--no-install") flags.install = false;
    else if (a === "--js") flags.js = args[++i];
    else if (a === "--check") flags.check = args[++i];
    else if (a === "--ci") flags.ci = args[++i];
    else if (a === "--json") flags.json = true;
    else if (a === "--template") flags.template = args[++i];
    else if (a === "--pm") flags.pm = args[++i];
    else if (a === "--store") flags.store = args[++i];
  }
  return flags;
}

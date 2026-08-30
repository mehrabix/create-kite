#!/usr/bin/env node

import { promises as fs } from "fs";
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
        components: false,
        store: flags.store || "",
        git: true,
        install: true,
      }
    : {
        template: await promptTemplate(),
        pm: await promptPackageManager(),
        tailwind: await promptConfirm("Include Tailwind CSS v4?", true),
        preflight: false,
        components: await promptConfirm("Include LiqKit components?", false),
        store: await promptOptional("Store URL? (e.g. my-store.myshopify.com) [skip]", ""),
        git: await promptConfirm("Initialize a git repository?", true),
        install: await promptConfirm("Install dependencies now?", true),
      };

  // --tailwind/--no-tailwind, --preflight, --components/--no-components override prompts
  if (flags.tailwind !== undefined) answers.tailwind = flags.tailwind;
  if (flags.preflight) answers.preflight = true;
  if (flags.components !== undefined) answers.components = flags.components;
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

    console.log(`${col.cyan}⏳ Copying template "${answers.template}"...${col.reset}`);
    await copyDir(path.join(TEMPLATES_DIR, answers.template), targetDir);

    if (answers.tailwind) {
      console.log(`${col.cyan}⚡ Setting up Tailwind CSS v4...${col.reset}`);
      await writeTailwind(targetDir, answers);
      await appendThemeStylesheet(targetDir, answers);
    }

    if (answers.components) {
      console.log(`${col.cyan}🧩 Installing LiqKit components...${col.reset}`);
      await copyDir(path.join(TEMPLATES_DIR, "components"), targetDir);
    }

    console.log(`${col.cyan}📝 Writing project files...${col.reset}`);
    await writeRootFiles(targetDir, answers, projectName);
    await writePackageJson(targetDir, answers, projectName);
    await writeReadme(targetDir, answers, projectName);

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

    if (answers.tailwind) {
      console.log(`${col.cyan}🎨 Building Tailwind CSS...${col.reset}`);
      const bin = path.join(targetDir, "node_modules", ".bin", "tailwindcss");
      execSync(
        `"${bin}" -i ./src/tailwind-input.css -o ./assets/tailwind.css --minify`,
        { cwd: targetDir, stdio: "inherit" }
      );
    }

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
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const ask = () => {
      rl.question(`${col.green}📛 Project name: ${col.reset}`, (name) => {
        name = name.trim();
        if (name && /^[a-z0-9-]+$/i.test(name)) {
          rl.close();
          resolve(name);
        } else {
          console.log(`${col.yellow}⚠️ Use lowercase letters, numbers, and dashes.${col.reset}`);
          ask();
        }
      });
    };
    ask();
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
  return promptChoice("Template", ["minimal", "full", "components"]);
}

function promptPackageManager() {
  return promptChoice("Package manager", ["pnpm", "npm", "bun", "yarn"]);
}

function promptConfirm(message, def) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const suffix = def ? " (Y/n)" : " (y/N)";
    rl.question(`${col.green}❓ ${message}${suffix} ${col.reset}`, (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      if (a === "y" || a === "yes") resolve(true);
      else if (a === "n" || a === "no") resolve(false);
      else resolve(def);
    });
  });
}

function promptOptional(message) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(`${col.green}❓ ${message} ${col.reset}`, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function promptChoice(title, choices) {
  return new Promise((resolve) => {
    let currentIndex = 0;
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const display = () => {
      console.clear();
      console.log(`${col.green}Please choose a ${title}:${col.reset}`);
      choices.forEach((choice, i) => {
        const isSelected = i === currentIndex ? "👉" : "   ";
        console.log(`${isSelected} ${choice}`);
      });
    };

    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);

    process.stdin.on("keypress", (str, key) => {
      if (key.name === "escape") {
        rl.close();
        process.exit(0);
      }
      if (key.name === "up") {
        currentIndex = (currentIndex - 1 + choices.length) % choices.length;
      } else if (key.name === "down") {
        currentIndex = (currentIndex + 1) % choices.length;
      } else if (key.name === "return" || key.name === "space") {
        rl.close();
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        resolve(choices[currentIndex]);
      }
      display();
    });

    display();
  });
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
  const dev =
    answers.store !== ""
      ? `shopify theme dev --store ${answers.store}`
      : "shopify theme dev";
  const scripts = {
    dev,
    "css:build":
      "tailwindcss -i ./src/tailwind-input.css -o ./assets/tailwind.css --minify",
    "css:watch":
      "tailwindcss -i ./src/tailwind-input.css -o ./assets/tailwind.css --minify --watch",
    check: "shopify theme check",
  };
  return scripts;
}

async function writeTailwind(targetDir, answers) {
  const preflightImport = answers.preflight
    ? '@import "tailwindcss/preflight.css" layer(base);\n'
    : "";
  const input = `@layer theme, base, components, utilities;\n@import "tailwindcss/theme.css" layer(theme);\n${preflightImport}@import "tailwindcss/utilities.css" layer(utilities);\n\n/* Scan Liquid files for utility classes */\n@source "../layout";\n@source "../sections";\n@source "../snippets";\n@source "../blocks";\n@source "../templates";\n`;
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

  const themeCheck = "extends: theme-check:recommended\n";

  const editorconfig = `root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2
`;

  const pnpmWorkspace =
    answers.pm === "pnpm" ? "onlyBuiltDependencies:\n  - '@parcel/watcher'\n" : "";

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
  const pkg = {
    name: pkgName,
    version: "0.1.0",
    private: true,
    description: `Shopify Liquid theme scaffolded with create-kite`,
    scripts: themeScripts(answers, projectName),
    devDependencies: answers.tailwind
      ? {
          "@tailwindcss/cli": "^4.3.0",
          tailwindcss: "^4.3.0",
        }
      : {},
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
pnpm install${answers.tailwind ? "\npnpm css:build" : ""}
pnpm dev
\`\`\`

${answers.store ? `Store: \`${answers.store}\`` : "Run \`shopify theme dev --store YOUR-STORE.myshopify.com\`"}

## Scripts

| Script | Purpose |
|--------|---------|
| \`dev\` | \`shopify theme dev\`${answers.store ? ` (\`${answers.store}\`)` : ""} |
${answers.tailwind ? "| `css:build` | Build Tailwind CSS to assets/tailwind.css |\n| `css:watch` | Rebuild Tailwind on file change |\n" : ""}| \`check\` | Run theme-check |

## Stack

- Shopify Liquid (Online Store 2.0)
${answers.tailwind ? "- Tailwind CSS v4 (preflight " + (answers.preflight ? "on" : "off") + ")" : ""}${answers.components ? "\n- LiqKit components" : ""}

Scaffolded with [create-kite](https://github.com/mehrabix/create-kite).
`;
  await fs.writeFile(path.join(targetDir, "README.md"), readme);
}

function done(answers, targetDir) {
  console.log(`${col.green}✅ Project ready in ./${path.basename(targetDir)}${col.reset}`);
  console.log(`${col.blue}Next steps:${col.reset}`);
  console.log(`  cd ${path.basename(targetDir)}`);
  if (answers.install) {
    console.log(`  ${answers.pm} run dev`);
  } else {
    console.log(`  ${answers.pm} install`);
    console.log(`  ${answers.pm} run dev`);
  }
  if (answers.tailwind) {
    console.log(`  # in another terminal:`);
    console.log(`  ${answers.pm} run css:watch`);
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
    components: undefined,
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
    else if (a === "--components") flags.components = true;
    else if (a === "--no-components") flags.components = false;
    else if (a === "--no-git") flags.git = false;
    else if (a === "--no-install") flags.install = false;
    else if (a === "--template") flags.template = args[++i];
    else if (a === "--pm") flags.pm = args[++i];
    else if (a === "--store") flags.store = args[++i];
  }
  return flags;
}

import esbuild from "esbuild";

const production = process.argv.includes("production");

const options = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "cjs",
  platform: "browser",
  target: "es2018",
  // 'obsidian' and Electron/Node built-ins are provided by the host at runtime.
  external: ["obsidian", "electron", "fs", "path", "crypto", "stream", "zlib", "http", "https", "url", "util", "assert", "buffer", "events"],
  // The fonts ship inside main.js: the plugin store installs nothing else.
  loader: { ".ttf": "base64" },
  outfile: "main.js",
  sourcemap: production ? false : "inline",
  minify: production,
  logLevel: "info"
};

if (production) {
  await esbuild.build(options).catch(() => process.exit(1));
} else {
  const ctx = await esbuild.context(options);
  await ctx.watch();
}

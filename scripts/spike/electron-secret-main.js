const { app, utilityProcess } = require("electron");
const path = require("path");

app.whenReady().then(() => {
  const child = utilityProcess.fork(path.join(__dirname, "secret-isolation-child.js"), [], {
    stdio: "pipe",
    // Explicit env: only pass what's needed, NOT the full parent env
    // This demonstrates the allowlist mechanism
    env: {
      NODE_PATH: process.env.NODE_PATH || "",
      PATH: process.env.PATH || "",
      // NOTE: No PROVIDER_API_KEY here — the child reads it from file
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
    },
  });

  child.stdout.on("data", (data) => {
    process.stdout.write(data.toString());
  });

  child.stderr.on("data", (data) => {
    process.stderr.write(data.toString());
  });

  child.on("exit", (code) => {
    if (code !== 0) {
      console.log(JSON.stringify({ error: "child exited with code " + code }));
    }
    app.quit();
  });
});

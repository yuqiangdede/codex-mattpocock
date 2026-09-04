const { app, utilityProcess } = require("electron");
const path = require("path");

app.whenReady().then(() => {
  const child = utilityProcess.fork(path.join(__dirname, "sqlite-test-child.js"), [], {
    stdio: "pipe",
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

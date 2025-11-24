"use strict";
try {
  require("./dist/src/api/server.js");
} catch (err) {
  console.error(err);
  process.exit(1);
}
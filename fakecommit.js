import path from "node:path";
import { execSync } from "node:child_process";
import fs from "fs-extra";
import simpleGit from "simple-git";
import { config } from "./config/config.js";

// --- //

const COMMIT_MESSAGE = "...";
const COMMIT_DATE = new Date(2000, 1, 30, 10).toISOString();

// --- //

const git = simpleGit("./local_repo");
await git.pull();
const filePath = path.join("./local_repo", "syncfile.txt");
fs.appendFileSync(filePath, "Fake: " + COMMIT_MESSAGE + "\n");
await git.add("syncfile.txt");
const env = {
    ...process.env,
    GIT_AUTHOR_NAME: config.author.name,
    GIT_AUTHOR_EMAIL: config.author.email,
    GIT_AUTHOR_DATE: COMMIT_DATE,
    GIT_COMMITTER_NAME: config.author.name,
    GIT_COMMITTER_EMAIL: config.author.email,
    GIT_COMMITTER_DATE: COMMIT_DATE,
};
execSync(`git commit --no-gpg-sign -m "${COMMIT_MESSAGE}"`, {
    cwd: "./local_repo",
    env,
});
execSync("git push", { cwd: "./local_repo" });
console.log("Done!");

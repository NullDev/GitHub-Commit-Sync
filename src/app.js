import path from "node:path";
import { execSync } from "node:child_process";
import fs from "fs-extra";
import simpleGit from "simple-git";
import { Octokit } from "octokit";
import { config } from "../config/config.js";
import Log from "./util/log.js";

const octokitSecondary = new Octokit({
    auth: config.auth.secondary_account_token,
});

const { data: secondaryUser } =
await octokitSecondary.rest.users.getAuthenticated();
const secondaryUsername = secondaryUser.login;

let processedShas = [];
if (fs.existsSync(config.processed_shas_file)){
    processedShas = JSON.parse(
        fs.readFileSync(config.processed_shas_file, "utf8"),
    );
}

const repos = await octokitSecondary.paginate(
    octokitSecondary.rest.repos.listForAuthenticatedUser,
    { visibility: "all", per_page: 100, affiliation: "owner,collaborator,organization_member" },
);

const reposToExcluse = config.repos_to_exclude || [];
const filteredRepos = repos.filter((repo) => !reposToExcluse.includes(repo.name));

let commitsMade = false;

for (const repo of filteredRepos){
    Log.info(`Processing repository: ${repo.full_name}`);

    const commits = await octokitSecondary.paginate(
        octokitSecondary.rest.repos.listCommits,
        {
            owner: repo.owner.login,
            repo: repo.name,
            author: secondaryUsername,
            per_page: 100,
        },
    );

    for (const commit of commits){
        const { sha } = commit;

        if (processedShas.includes(sha)){
            continue;
        }

        if (!fs.existsSync(config.local_repo_path)){
            Log.info("Cloning the primary repository...");
            await simpleGit().clone(
                `https://${config.auth.main_account_token}@github.com/${config.sync_repo_owner}/${config.sync_repo_name}.git`,
                config.local_repo_path,
            );
        }

        const git = simpleGit(config.local_repo_path);

        if (!commitsMade){
            await git.pull();
        }

        const filePath = path.join(config.local_repo_path, "syncfile.txt");
        fs.appendFileSync(filePath, `Sync commit: ${sha}\n`);

        await git.add("syncfile.txt");

        const env = {
            ...process.env,
            GIT_AUTHOR_NAME: config.author.name,
            GIT_AUTHOR_EMAIL: config.author.email,
            GIT_AUTHOR_DATE: commit.commit.author?.date || commit.commit.committer?.date || new Date().toISOString(),
            GIT_COMMITTER_NAME: config.author.name,
            GIT_COMMITTER_EMAIL: config.author.email,
            GIT_COMMITTER_DATE: commit.commit.committer?.date || commit.commit.author?.date || new Date().toISOString(),
        };

        const message = `Sync commit: ${sha}`;
        execSync(`git commit --no-gpg-sign -m "${message}"`, {
            cwd: config.local_repo_path,
            env,
        });

        Log.info(`Processed commit: ${sha}`);

        commitsMade = true;
        processedShas.push(sha);
    }
}

if (commitsMade){
    Log.info("Pushing all commits...");
    execSync("git push", { cwd: config.local_repo_path });

    fs.writeFileSync(
        config.processed_shas_file,
        JSON.stringify(processedShas, null, 2),
    );
}

Log.done("All commits have been processed.");
process.exit(0);

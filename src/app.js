import path from "node:path";
import { execSync } from "node:child_process";
import fs from "fs-extra";
import simpleGit from "simple-git";
import { Octokit } from "octokit";
import { config } from "../config/config.js";
import Log from "./util/log.js";

// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

const octokitSecondary = new Octokit({ auth: config.auth.secondary_account_token });

const { data: secondaryUser } = await octokitSecondary.rest.users.getAuthenticated();
const secondaryUsername = secondaryUser.login;

let processedItems = /** @type {{ shas: String[], prs: Number[], issues: Number[] }} */ ({ shas: [], prs: [], issues: [] });
if (fs.existsSync("./processed_shas.json")){
    processedItems = JSON.parse(fs.readFileSync("./processed_shas.json", "utf8"));
}

const { shas: processedShas, prs: processedPrs, issues: processedIssues } = processedItems;

const repos = await octokitSecondary.paginate(
    octokitSecondary.rest.repos.listForAuthenticatedUser,
    {
        visibility: "all",
        per_page: 100,
        affiliation: "owner,collaborator,organization_member",
    },
);

const reposToExclude = config.repos_to_exclude || [];
const filteredRepos = repos.filter((repo) => !reposToExclude.includes(repo.name));

let commitsMade = false;

for (const repo of filteredRepos){
    Log.info(`Processing repository: ${repo.full_name}`);

    if (!fs.existsSync("./local_repo")){
        Log.info("Cloning the primary repository...");
        await simpleGit().clone(
            `https://${config.auth.main_account_token}@github.com/${config.sync_repo_owner}/${config.sync_repo_name}.git`,
            "./local_repo",
        );
    }

    const git = simpleGit("./local_repo");
    await git.pull();

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
            Log.info(`Skipping already processed commit: ${sha}`);
            continue;
        }

        const isMergeCommit = commit.parents && commit.parents.length > 1;
        const filePath = path.join("./local_repo", "syncfile.txt");
        const commitType = isMergeCommit ? "merge commit" : "commit";

        fs.appendFileSync(filePath, `Sync ${commitType}: ${sha}\n`);
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

        const message = `Sync ${commitType}: ${sha}`;
        execSync(`git commit --no-gpg-sign -m "${message}"`, {
            cwd: "./local_repo",
            env,
        });

        Log.info(`Processed ${commitType}: ${sha}`);

        commitsMade = true;
        processedShas.push(sha);
    }

    const issuesAndPRs = await octokitSecondary.paginate(
        octokitSecondary.rest.issues.listForRepo,
        {
            owner: repo.owner.login,
            repo: repo.name,
            creator: secondaryUsername,
            state: "all",
            per_page: 100,
        },
    );

    for (const issueOrPr of issuesAndPRs){
        const isPR = !!issueOrPr.pull_request;
        const { number } = issueOrPr;

        if (isPR){
            if (processedPrs.includes(number)){
                Log.info(`Skipping already processed PR: ${number}`);
                continue;
            }

            const filePath = path.join("./local_repo", "syncfile.txt");
            fs.appendFileSync(filePath, `Sync PR: ${number}\n`);
            await git.add("syncfile.txt");

            const env = {
                ...process.env,
                GIT_AUTHOR_NAME: config.author.name,
                GIT_AUTHOR_EMAIL: config.author.email,
                GIT_AUTHOR_DATE: issueOrPr.created_at || new Date().toISOString(),
                GIT_COMMITTER_NAME: config.author.name,
                GIT_COMMITTER_EMAIL: config.author.email,
                GIT_COMMITTER_DATE: issueOrPr.created_at || new Date().toISOString(),
            };

            const message = `Sync PR: ${number}`;
            execSync(`git commit --no-gpg-sign -m "${message}"`, {
                cwd: "./local_repo",
                env,
            });

            Log.info(`Processed PR: ${number}`);

            commitsMade = true;
            processedPrs.push(number);
        }
        else {
            if (processedIssues.includes(number)){
                Log.info(`Skipping already processed Issue: ${number}`);
                continue;
            }

            const filePath = path.join("./local_repo", "syncfile.txt");
            fs.appendFileSync(filePath, `Sync Issue: ${number}\n`);
            await git.add("syncfile.txt");

            const env = {
                ...process.env,
                GIT_AUTHOR_NAME: config.author.name,
                GIT_AUTHOR_EMAIL: config.author.email,
                GIT_AUTHOR_DATE: issueOrPr.created_at || new Date().toISOString(),
                GIT_COMMITTER_NAME: config.author.name,
                GIT_COMMITTER_EMAIL: config.author.email,
                GIT_COMMITTER_DATE: issueOrPr.created_at || new Date().toISOString(),
            };

            const message = `Sync Issue: ${number} - ${issueOrPr.title}`;
            execSync(`git commit --no-gpg-sign -m "${message}"`, {
                cwd: "./local_repo",
                env,
            });

            Log.info(`Processed Issue: ${number}`);

            commitsMade = true;
            processedIssues.push(number);
        }
    }
}

if (commitsMade){
    Log.info("Pushing all commits...");
    execSync("git push", { cwd: "./local_repo" });

    fs.writeFileSync(
        "./processed_shas.json",
        JSON.stringify(
            {
                shas: processedShas,
                prs: processedPrs,
                issues: processedIssues,
            },
            null,
            2,
        ),
    );
}

Log.done("All commits have been processed.");
process.exit(0);

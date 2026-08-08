import assert from "node:assert/strict";
import test from "node:test";
import { SyncService } from "../application/sync-service.js";
import { PROJECT_NEXT_STEPS, PROJECT_STATUSES } from "../core/projection.js";
import { createApp } from "./support/app.js";
import { FakeGitHub } from "./support/github.js";
import { createRepo } from "./support/repo.js";

function serviceWith(repoPath: string, github: FakeGitHub, project?: { owner: string; number: number }): SyncService {
  const app = createApp(repoPath);
  return new SyncService(app.store, github, project);
}

test("no configured project is reported, not treated as a failure to access one", async () => {
  const repo = createRepo();
  try {
    const preparation = await serviceWith(repo.path, new FakeGitHub()).prepareProject();
    assert.equal(preparation.configured, false);
    assert.equal(preparation.ready, false);
    assert.equal(preparation.reason, "no project configured");
    assert.deepEqual(preparation.fields, []);
  } finally {
    repo.cleanup();
  }
});

test("an inaccessible project is reported with the reason it could not be resolved", async () => {
  const repo = createRepo();
  try {
    const github = new FakeGitHub();
    const preparation = await serviceWith(repo.path, github, { owner: "acme", number: 7 }).prepareProject();
    assert.equal(preparation.configured, true);
    assert.equal(preparation.ready, false);
    assert.deepEqual(preparation.missing, ["project acme/7 is not accessible"]);
    assert.match(preparation.reason as string, /not found/);
  } finally {
    repo.cleanup();
  }
});

test("missing fields are named one by one", async () => {
  const repo = createRepo();
  try {
    const github = new FakeGitHub();
    github.projects.set("acme/7", { id: "PVT_1", number: 7, owner: "acme" });
    const preparation = await serviceWith(repo.path, github, { owner: "acme", number: 7 }).prepareProject();
    assert.equal(preparation.ready, false);
    assert.deepEqual(
      preparation.fields.map((field) => ({ name: field.name, present: field.present })),
      [
        { name: "Status", present: false },
        { name: "Next Step", present: false },
      ],
    );
    assert.deepEqual(preparation.missing, [
      'single-select field "Status" does not exist',
      'single-select field "Next Step" does not exist',
    ]);
  } finally {
    repo.cleanup();
  }
});

test("a field missing only some options reports exactly those options", async () => {
  const repo = createRepo();
  try {
    const github = new FakeGitHub();
    github.projects.set("acme/7", { id: "PVT_1", number: 7, owner: "acme" });
    await github.createSingleSelectField("PVT_1", "Status", [PROJECT_STATUSES[0] as string]);
    await github.createSingleSelectField("PVT_1", "Next Step", [...PROJECT_NEXT_STEPS]);

    const preparation = await serviceWith(repo.path, github, { owner: "acme", number: 7 }).prepareProject();
    assert.equal(preparation.ready, false);
    const status = preparation.fields.find((field) => field.name === "Status");
    assert.equal(status?.present, true);
    assert.deepEqual(status?.missingOptions, PROJECT_STATUSES.slice(1));
    assert.equal(preparation.fields.find((field) => field.name === "Next Step")?.missingOptions.length, 0);
  } finally {
    repo.cleanup();
  }
});

test("a fully prepared project is ready, and preparing again says the same thing", async () => {
  const repo = createRepo();
  try {
    const github = new FakeGitHub();
    github.projects.set("acme/7", { id: "PVT_1", number: 7, owner: "acme" });
    await github.createSingleSelectField("PVT_1", "Status", [...PROJECT_STATUSES]);
    await github.createSingleSelectField("PVT_1", "Next Step", [...PROJECT_NEXT_STEPS]);

    const service = serviceWith(repo.path, github, { owner: "acme", number: 7 });
    const first = await service.prepareProject();
    assert.equal(first.ready, true);
    assert.deepEqual(first.missing, []);
    assert.equal(first.project?.id, "PVT_1");

    const second = await service.prepareProject();
    assert.deepEqual(second, first, "preparation is a report, so repeating it changes nothing");
    assert.equal(github.projectFields.get("PVT_1")?.length, 2, "preparation created no remote state");
  } finally {
    repo.cleanup();
  }
});

test("an injected transport failure is reported as inaccessible rather than thrown", async () => {
  const repo = createRepo();
  try {
    const github = new FakeGitHub();
    github.projects.set("acme/7", { id: "PVT_1", number: 7, owner: "acme" });
    github.failNext();
    const preparation = await serviceWith(repo.path, github, { owner: "acme", number: 7 }).prepareProject();
    assert.equal(preparation.ready, false);
    assert.match(preparation.reason as string, /injected GitHub failure/);
  } finally {
    repo.cleanup();
  }
});

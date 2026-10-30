import { describe, expect, it } from "vitest";
import { SqliteRequestRepository } from "./index.ts";
import { labBody, lena, testDeps } from "../domain/testkit.ts";

describe("SqliteRequestRepository (V2-BOOT-2)", () => {
  it("listOpen returns open requests across rooms only", async () => {
    const repo = new SqliteRequestRepository({ dataDir: ":memory:" });
    const t = testDeps({ repo });
    const a = (await t.service.createRequest(lena, labBody)).request;
    const b = (await t.service.createRequest(lena, { ...labBody, roomId: "!other:localhost" })).request;
    const c = (await t.service.createRequest(lena, labBody)).request;
    await repo.update({ ...c, status: "filed" });
    expect((await repo.listOpen()).map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("rotateTokenHash replaces the token hash and throws for unknown ids", async () => {
    const repo = new SqliteRequestRepository({ dataDir: ":memory:" });
    const t = testDeps({ repo });
    const { request } = await t.service.createRequest(lena, labBody);
    await repo.rotateTokenHash(request.id, "new-hash");
    expect((await repo.byTokenHash("new-hash"))?.id).toBe(request.id);
    await expect(repo.rotateTokenHash("nope", "x")).rejects.toThrow(/not found/);
  });
});

import { describe, expect, test } from "bun:test"
import app from "../src/app.ts"

describe("app", () => {
  test("GET /health returns ok", async () => {
    const res = await app.fetch(new Request("http://localhost/health"))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})

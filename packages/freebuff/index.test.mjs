import { test, expect } from "bun:test"
import { FreebuffPlugin } from "./index.mjs"

test("plugin exports the expected shape", async () => {
	const plugin = await FreebuffPlugin()

	expect(plugin).toBeDefined()
	expect(plugin.auth).toBeDefined()
	expect(plugin.auth.provider).toBe("freebuff")
	expect(plugin.auth.methods).toBeInstanceOf(Array)
	expect(plugin.auth.methods.length).toBeGreaterThan(0)
	expect(plugin.auth.methods[0].type).toBe("oauth")
	expect(plugin.auth.loader).toBeInstanceOf(Function)

	expect(plugin.config).toBeInstanceOf(Function)
	expect(plugin.provider).toBeDefined()
	expect(plugin.provider.id).toBe("freebuff")
	expect(plugin.provider.models).toBeInstanceOf(Function)
})

test("config hook sets provider metadata", async () => {
	const plugin = await FreebuffPlugin()
	const cfg = { provider: {} }

	await plugin.config(cfg)

	expect(cfg.provider.freebuff).toBeDefined()
	expect(cfg.provider.freebuff.name).toBe("Freebuff")
	expect(cfg.provider.freebuff.npm).toBe("@ai-sdk/openai-compatible")
	expect(cfg.provider.freebuff.api).toContain("codebuff.com")
	expect(cfg.provider.freebuff.models).toBeDefined()
})

test("loader requires auth", async () => {
	const plugin = await FreebuffPlugin()
	const getAuth = async () => null

	await expect(plugin.auth.loader(getAuth, {})).rejects.toThrow(/not signed in/)
})

test("loader with mock auth returns fetch handler", async () => {
	const plugin = await FreebuffPlugin()
	const getAuth = async () => ({ access: "mock-token" })

	const loader = await plugin.auth.loader(getAuth, {})

	expect(loader.baseURL).toContain("codebuff.com")
	expect(loader.fetch).toBeInstanceOf(Function)
})

test("models hook returns object", async () => {
	const plugin = await FreebuffPlugin()
	const models = await plugin.provider.models({ models: {} })

	expect(models).toBeInstanceOf(Object)
})

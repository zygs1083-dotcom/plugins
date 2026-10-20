// Freebuff provider plugin for OpenCode and magpie
// Signs in via device code flow, maintains session admission, signs requests with device keys

const PROVIDER = "freebuff"
const API_BASE = "https://www.codebuff.com"
const LOGIN_BASE = "https://freebuff.com"

// Freebuff's fixed agent/model constraints (from common/src/constants/free-agents.ts)
const FREEBUFF_AGENT_PUBLISHER = "codebuff"
const FREEBUFF_ROOT_SYSTEM_PROMPT_OPENING = "You are an expert software engineer"

// Headers and protocol constants
const CATALOG_PROTOCOL_VERSION = "1"
const MODEL_HANDLE_PREFIX = "fbm1."

// Session states
const SESSION_ACTIVE = "active"
const SESSION_ENDED = "ended"
const SESSION_HEARTBEAT_INTERVAL = 45000 // 45s

// Error that marks the sign-in gone
class Lapsed extends Error {
	constructor(message) {
		super(message)
		this.expired = true
	}
}

// Generate fingerprint ID (simplified - real CLI uses hardware info)
function generateFingerprintId() {
	const random = Array.from(crypto.getRandomValues(new Uint8Array(16)))
		.map(b => b.toString(16).padStart(2, "0"))
		.join("")
	return `codebuff-cli-${random}`
}

// Device sign-in flow
async function deviceSignIn({ client }) {
	const fingerprintId = generateFingerprintId()

	// Step 1: Request device code
	const codeRes = await fetch(`${LOGIN_BASE}/api/auth/cli/code`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ fingerprintId }),
	})
	if (!codeRes.ok) {
		const text = await codeRes.text()
		throw new Error(`Device code request failed: ${text}`)
	}
	const { loginUrl, fingerprintHash, expiresAt } = await codeRes.json()

	// Step 2: Open browser
	await client?.tui?.showToast?.({ message: `Opening ${loginUrl}`, type: "info" })
	// In a real implementation, would use client.tui.openBrowser or similar
	console.log(`Please open: ${loginUrl}`)

	// Step 3: Poll for completion (5 minutes max, poll every 5s)
	const pollUrl = `${LOGIN_BASE}/api/auth/cli/status?fingerprintId=${encodeURIComponent(fingerprintId)}&fingerprintHash=${encodeURIComponent(fingerprintHash)}&expiresAt=${encodeURIComponent(expiresAt)}`
	const pollEnd = Date.now() + 5 * 60 * 1000

	while (Date.now() < pollEnd) {
		await new Promise(resolve => setTimeout(resolve, 5000))

		const statusRes = await fetch(pollUrl)
		if (statusRes.status === 401) continue // Still waiting

		if (!statusRes.ok) {
			const text = await statusRes.text()
			throw new Error(`Status poll failed: ${text}`)
		}

		const { user } = await statusRes.json()
		if (!user) continue

		// Success - extract token
		const authToken = user.authToken || user.token
		if (!authToken) throw new Error("No auth token in response")

		return {
			type: "oauth",
			access: authToken,
			uid: user.id || "",
			email: user.email || "",
			name: user.name || "",
			fingerprintId,
			fingerprintHash,
		}
	}

	throw new Error("Device sign-in timed out after 5 minutes")
}

// Generate or load Ed25519 device key pair
// In production this would persist to config dir and use Web Crypto API
async function getOrCreateDeviceKey() {
	// Simplified: would actually persist to ~/.config/magpie/plugins/freebuff/device-key.json
	// and use crypto.subtle.generateKey("Ed25519")
	// For now, return a placeholder that indicates device signing is not yet implemented
	return null
}

// Sign request payload with device key
function signRequest(method, path, timestamp, bodyHash, fetchId, privateKey) {
	// Real implementation would:
	// 1. Build payload: `freebuff-device-v1\n${METHOD}\n${path}\n${timestamp}\n${bodyHash}\n${fetchId}`
	// 2. Sign with Ed25519 private key
	// 3. Return base64url signature
	return null
}

// Main plugin export
export const FreebuffPlugin = async ({ client } = {}, options = {}) => {
	// In-memory state
	let catalogCache = null
	let sessionState = { status: "none" }
	let deviceKey = null

	// Load device key on init
	try {
		deviceKey = await getOrCreateDeviceKey()
	} catch (e) {
		console.warn("Device key initialization failed:", e)
	}

	// Get fresh auth token
	const getToken = async (getAuth) => {
		const auth = await getAuth()
		if (!auth?.access) throw new Lapsed("Freebuff: not signed in")
		return auth.access
	}

	// Fetch model catalog
	const fetchCatalog = async (token) => {
		const headers = {
			"Authorization": `Bearer ${token}`,
			"x-freebuff-catalog-protocol": CATALOG_PROTOCOL_VERSION,
			"x-freebuff-client": "cli",
			"x-freebuff-client-version": "0.2.30",
			"x-freebuff-env": "production",
		}

		// TODO: Add device signing headers if deviceKey available

		const res = await fetch(`${API_BASE}/api/v1/freebuff/models`, { headers })
		if (!res.ok) {
			const text = await res.text()
			throw new Error(`Catalog fetch failed: ${text}`)
		}

		const catalog = await res.json()
		catalogCache = {
			...catalog,
			fetchedAt: Date.now(),
		}
		return catalog
	}

	// Request session admission
	const requestSession = async (token, modelHandle) => {
		const instanceId = `cli:${crypto.randomUUID()}`

		const headers = {
			"Authorization": `Bearer ${token}`,
			"x-freebuff-model": modelHandle,
			"x-freebuff-wallet-spend-limit": "session",
			"x-freebuff-instance-id": instanceId,
			"x-freebuff-multi-session": "1",
			"x-freebuff-purchase-continuity": "1",
			"x-freebuff-env": "production",
			"x-freebuff-client-version": "0.2.30",
			"x-fb-timezone": Intl.DateTimeFormat().resolvedOptions().timeZone,
		}

		if (catalogCache?.fetchId) {
			headers["x-freebuff-catalog-protocol"] = CATALOG_PROTOCOL_VERSION
			headers["x-freebuff-catalog-fetch"] = catalogCache.fetchId
		}

		// TODO: Add device signing headers

		const res = await fetch(`${API_BASE}/api/v1/freebuff/session/admission`, {
			method: "POST",
			headers,
		})

		if (!res.ok) {
			const text = await res.text()
			// Parse common errors
			if (res.status === 403) throw new Error(`Session refused (403): ${text}`)
			if (res.status === 429) throw new Error(`Rate limited (429): ${text}`)
			throw new Error(`Session admission failed (${res.status}): ${text}`)
		}

		const session = await res.json()
		if (session.status === SESSION_ACTIVE) {
			sessionState = {
				status: SESSION_ACTIVE,
				instanceId: session.instanceId || instanceId,
				model: modelHandle,
				admittedAt: Date.now(),
			}
		} else {
			throw new Error(`Session not active: ${session.status}`)
		}

		return session
	}

	return {
		config: async (cfg) => {
			cfg.provider ??= {}
			const was = cfg.provider[PROVIDER] ?? {}
			cfg.provider[PROVIDER] = {
				name: "Freebuff",
				npm: "@ai-sdk/openai-compatible",
				api: `${API_BASE}/api/v1`,
				...was,
				models: {
					// Placeholder models - real ones come from catalog
					"mimo/mimo-v2.6-flash-fast": {
						id: "mimo/mimo-v2.6-flash-fast",
						name: "MiMo v2.6 Flash Fast",
						contextWindow: 200000,
					},
					...(was.models ?? {}),
				},
			}
		},

		auth: {
			provider: PROVIDER,

			async loader(getAuth, provider) {
				const token = await getToken(getAuth)

				// Fetch catalog once
				if (!catalogCache) {
					try {
						await fetchCatalog(token)
					} catch (e) {
						console.warn("Catalog fetch failed, using placeholder models:", e)
					}
				}

				return {
					baseURL: `${API_BASE}/api/v1`,
					apiKey: "freebuff", // Placeholder, actual auth via Bearer

					async fetch(input, init = {}) {
						const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
						const urlObj = new URL(url)

						// Only handle chat completions
						if (!urlObj.pathname.endsWith("/chat/completions")) {
							return new Response(JSON.stringify({ error: "Only chat completions supported" }), {
								status: 404,
								headers: { "content-type": "application/json" },
							})
						}

						// Parse request body
						let body
						try {
							const bodyText = init.body || (input instanceof Request ? await input.text() : "{}")
							body = JSON.parse(bodyText)
						} catch {
							return new Response(JSON.stringify({ error: "Invalid request body" }), {
								status: 400,
								headers: { "content-type": "application/json" },
							})
						}

						const modelId = body.model

						// Request session if needed
						if (sessionState.status !== SESSION_ACTIVE || sessionState.model !== modelId) {
							try {
								await requestSession(token, modelId)
							} catch (e) {
								return new Response(JSON.stringify({ error: e.message }), {
									status: 502,
									headers: { "content-type": "application/json" },
								})
							}
						}

						// Build request headers
						const headers = new Headers(init.headers || (input instanceof Request ? input.headers : {}))
						headers.set("Authorization", `Bearer ${token}`)
						headers.set("user-agent", "ai-sdk/openai-compatible/4.0.0/codebuff")
						headers.set("x-freebuff-sse-gzip-recovery", "1")

						if (catalogCache?.fetchId) {
							headers.set("x-freebuff-catalog-fetch", catalogCache.fetchId)
						}

						// TODO: Add device signing headers

						// Inject freebuff metadata into body
						const freebuffBody = {
							...body,
							codebuff_metadata: {
								run_id: crypto.randomUUID(),
								client_id: "magpie-plugin",
								cost_mode: "free",
								freebuff_instance_id: sessionState.instanceId,
								freebuff_multi_session: "1",
								surface: "cli",
								freebuff_client_env: "production",
								...(body.codebuff_metadata || {}),
							},
						}

						// Make request
						try {
							const res = await fetch(url, {
								...init,
								method: "POST",
								headers,
								body: JSON.stringify(freebuffBody),
							})

							return res
						} catch (e) {
							return new Response(JSON.stringify({ error: String(e) }), {
								status: 502,
								headers: { "content-type": "application/json" },
							})
						}
					},
				}
			},

			methods: [
				{ type: "oauth", label: "Sign in to Freebuff (browser)", authorize: deviceSignIn },
			],
		},

		provider: {
			id: PROVIDER,
			async models(provider) {
				// Return catalog models if available
				if (catalogCache?.rows) {
					return Object.fromEntries(
						catalogCache.rows
							.filter(row => row.access === "open" && row.handle?.startsWith(MODEL_HANDLE_PREFIX))
							.map(row => [
								row.key,
								{
									id: row.handle,
									name: row.displayName || row.key,
									contextWindow: row.contextWindow || 200000,
									...(row.multimodal ? { capabilities: { vision: true } } : {}),
								},
							])
					)
				}

				// Fallback to configured models
				return provider?.models ?? {}
			},
		},
	}
}

export default { id: PROVIDER, server: FreebuffPlugin }

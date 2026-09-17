import {
	env,
	createExecutionContext,
	waitOnExecutionContext,
	SELF,
} from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker, { detectFillerOccurrences, shouldUseFillerAudit } from "../src/index";

// For now, you'll need to do something like this to get a correctly-typed
// `Request` to pass to `worker.fetch()`.
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe("B-01 AI worker", () => {
	it("counts hard, contextual, and phrase fillers deterministically", () => {
		const fillers = detectFillerOccurrences(
			"Uhhh ummm uhmmm oh mm erm er ah uhu e huh eh mhm I think, you know, this is like basically ready.",
		);

		expect(fillers.map((item) => item.normalized)).toEqual([
			"uh",
			"um",
			"uhm",
			"oh",
			"mm",
			"erm",
			"er",
			"ah",
			"uhu",
			"e",
			"huh",
			"eh",
			"mhm",
			"you",
			"know",
			"like",
			"basically",
		]);
		expect(fillers).toHaveLength(17);
	});

	it("prefers filler audit results when they recover more hard fillers", () => {
		expect(shouldUseFillerAudit(
			[{ kind: "contextual" }, { kind: "hard" }],
			[{ kind: "contextual" }, { kind: "hard" }, { kind: "hard" }],
		)).toBe(true);

		expect(shouldUseFillerAudit(
			[{ kind: "contextual" }, { kind: "hard" }],
			[{ kind: "contextual" }, { kind: "hard" }],
		)).toBe(false);
	});

	it("responds to health checks with CORS headers (unit style)", async () => {
		const request = new IncomingRequest("http://example.com/health");
		// Create an empty context to pass to `worker.fetch()`.
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		// Wait for all `Promise`s passed to `ctx.waitUntil()` to settle before running test assertions
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
		expect(await response.json()).toMatchObject({
			ok: true,
			service: "b01-ai-worker",
			status: "online",
		});
	});

	it("responds to preflight requests with CORS headers (integration style)", async () => {
		const response = await SELF.fetch("https://example.com/health", {
			method: "OPTIONS",
			headers: {
				Origin: "http://localhost:5173",
				"Access-Control-Request-Method": "GET",
			},
		});
		expect(response.status).toBe(204);
		expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
		expect(response.headers.get("Access-Control-Allow-Methods")).toContain("GET");
	});
});

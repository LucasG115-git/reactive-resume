import { describe, expect, it } from "vite-plus/test";
import { formatProfileDate, metricLabel, splitList } from "./profile";

describe("master profile helpers", () => {
	it("splits comma lists, trimming blanks and repeats", () => {
		expect(splitList(" WordPress, UX research,,WordPress , ")).toEqual(["WordPress", "UX research"]);
		expect(splitList("")).toEqual([]);
	});

	it("formats partial dates", () => {
		expect(formatProfileDate("2019", "en-US")).toBe("2019");
		expect(formatProfileDate("2019-03", "en-US")).toBe("Mar 2019");
		expect(formatProfileDate(null)).toBe("");
	});

	it("writes metrics as they read on a resume", () => {
		expect(metricLabel({ value: "40", unit: "%", label: "less admin time" })).toBe("40% less admin time");
		expect(metricLabel({ value: "3x", unit: "", label: "" })).toBe("3x");
	});
});

export interface TimingResult<T> {
	readonly median: number;
	readonly samples: readonly number[];
	readonly results: readonly T[];
}

export function measureMedian<T>(createWorkload: () => () => T): TimingResult<T> {
	const results: T[] = [];
	for (let index = 0; index < 2; index++) results.push(createWorkload()());
	const samples: number[] = [];
	for (let index = 0; index < 5; index++) {
		const workload = createWorkload();
		const start = performance.now();
		results.push(workload());
		samples.push(performance.now() - start);
	}
	const ordered = [...samples].sort((left, right) => left - right);
	return { median: ordered[Math.floor(ordered.length / 2)]!, samples, results };
}

export function formatDurations(result: TimingResult<unknown>): string {
	return `${result.median.toFixed(2)}ms [${result.samples.map((sample) => sample.toFixed(2)).join(", ")}]`;
}

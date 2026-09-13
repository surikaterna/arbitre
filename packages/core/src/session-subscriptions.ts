import type { StateChange, SubscriptionCallback, Unsubscribe } from "./contracts.js";

export interface SessionSubscriptions {
	readonly subscribe: (path: string, callback: SubscriptionCallback) => Unsubscribe;
	readonly notify: (changes: readonly StateChange[]) => void;
	readonly clear: () => void;
}

export function createSessionSubscriptions(assertNotDisposed: () => void): SessionSubscriptions {
	const subscriptions = new Map<string, Set<SubscriptionCallback>>();

	function subscribe(path: string, callback: SubscriptionCallback): Unsubscribe {
		assertNotDisposed();
		let callbacks = subscriptions.get(path);
		if (!callbacks) {
			callbacks = new Set();
			subscriptions.set(path, callbacks);
		}
		callbacks.add(callback);
		return () => callbacks.delete(callback);
	}

	function notify(changes: readonly StateChange[]): void {
		for (const change of changes) {
			const callbacks = subscriptions.get(change.path);
			if (!callbacks) continue;
			for (const callback of callbacks) callback(change.newValue, change.previousValue);
		}
	}

	return { subscribe, notify, clear: () => subscriptions.clear() };
}

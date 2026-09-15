import type { Agenda } from "./agenda.js";
import type { RuleSession } from "./contracts.js";
import type { ScopeManager } from "./scope.js";

export function createStateApi<TState>(
	assertNotDisposed: () => void,
	scope: ScopeManager,
	agenda: Agenda,
): Pick<RuleSession<TState>, "getState" | "getPath" | "setFocus"> {
	return {
		getState: () => {
			assertNotDisposed();
			return scope.getState();
		},
		getPath: (path) => {
			assertNotDisposed();
			return scope.get(path);
		},
		setFocus: (group) => {
			assertNotDisposed();
			agenda.setFocus(group);
		},
	};
}

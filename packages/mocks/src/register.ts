// A preload module: an app's dev:mock script loads this with node's `--import`
// before the app itself, so the MSW interceptors are up before the first API
// call. It self-gates on MOCK_API, so the same flag both selects the script and
// arms the mock — there is no mock branch anywhere in the app's own code.
import { startMockApi } from "./node.js";

if (process.env.MOCK_API === "1") {
  startMockApi();
}

/** The plain store worker: the core API, no app methods. */

import { serveStore } from './store-worker-core';

serveStore(() => ({}));

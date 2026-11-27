#!/usr/bin/env tsx
/** Rewrites fixtures/SHA256SUMS from the files now in fixtures/. */
import { writeChecksums } from './checksums';

writeChecksums();

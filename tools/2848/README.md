# Form 2848 Generator

Fills **Page 1** of IRS Form 2848 (Power of Attorney and Declaration of Representative) by stamping text onto the official IRS PDF template at fixed coordinates.

## Origin

Migrated from [`JLW-Dev-Coder/2848`](https://github.com/JLW-Dev-Coder/2848), which was a self-contained browser HTML page (`2848-generator.html`) that read taxpayer/representative data from URL query params and used `pdf-lib` to stamp text onto `f2848.pdf`. The JS logic has been extracted into a reusable ES module (`generator.js`) that runs in both Node and Cloudflare Workers. The original browser page is preserved in git history of the source repo.

## Files

| Path | Purpose |
|------|---------|
| `generator.js` | Core ESM module — `generate2848Pdf(input, templateBytes)` returns PDF bytes. Pure function, no I/O. |
| `template/f2848.pdf` | Official IRS Form 2848 template. Loaded by the caller and passed into `generate2848Pdf` as bytes. |

## Usage

```js
import { generate2848Pdf, buildFilename } from '../../tools/2848/generator.js';

// In a Worker, load the template from R2 or KV (or embed it at build time).
const templateBytes = await env.R2_VIRTUAL_LAUNCH.get('tools/2848/f2848.pdf').then((o) => o.arrayBuffer());

const pdfBytes = await generate2848Pdf(input, templateBytes);
const filename = buildFilename(input) + '.pdf';
```

## Input schema (informal)

### Taxpayer

| Field | Required | Notes |
|-------|----------|-------|
| `clientFirstName` | yes | |
| `clientLastName` | yes | |
| `TaxpayerSSNITIN` | yes | 9 digits; auto-formatted to `XXX-XX-XXXX` |
| `clientAddressLine1` | yes | |
| `clientAddressLine2` | no | |
| `clientAddressTown` | yes | |
| `clientAddressRegion` | yes | US state code |
| `clientAddressZip` | yes | |

### Representative (single rep, Part I, row 1)

| Field | Required | Notes |
|-------|----------|-------|
| `repFirst` | yes | |
| `repLast` | yes | |
| `repCAF` | yes | CAF number |
| `repPTIN` | yes | Preparer Tax ID |
| `repTel` | yes | |
| `repFax` | no | |
| `repAddr1` | yes | |
| `repAddr2` | no | |
| `repCity` | yes | |
| `repState` | yes | |
| `repZip` | yes | |

### Tax matters (Line 3)

| Field | Required | Default |
|-------|----------|---------|
| `line3DescriptionOfMatter` | no | `"Income, Employment, Payroll, Excise, Estate, Gift, Civil Penalty, Sec. 4980H Shared Responsibility Payment"` |
| `line3TaxFormNumber` | no | `"940, 941, 720, 1040, 1120, 1120S"` |
| `yearFrom` | yes | First tax year (e.g. `"2015"`) |
| `yearTo` | yes | Last tax year (e.g. `"2024"`) — rendered as `"{yearFrom} through {yearTo}"` |

### Authorization acts (Line 5a checkboxes)

| Field | Default |
|-------|---------|
| `line5aAccessRecords` | `true` (Access my IRS records via ISP) |
| `line5aSubstituteOrAddRep` | `true` (Substitute or add representatives) |
| `line5aAuthorizeDisclosure` | `false` |
| `line5aSignReturn` | `false` |

## Output

- **Return value:** `Uint8Array` — raw PDF bytes of filled Form 2848 Page 1.
- **Filename convention:** `Form_2848_{LastName}_{FirstName}_DateSigned_{YYYY_MMDD}_p1.pdf` (helper: `buildFilename(input)`).

## Text placement

Coordinates are hard-coded in `generator.js` (`POS` object) and were visually aligned against the IRS template on `2026-01-22`. The build ID `2848-align-2026-01-22-h` is exported for audit. If the IRS reissues Form 2848 with a new layout, coordinates must be re-aligned and the build ID bumped.

## Where this fits in the ecosystem

| Consumer | Flow | Prompt |
|----------|------|--------|
| TMP client-facing eSign flow | Client signs 2848 during Phase 1 onboarding → served filled PDF for review before signature. | Wired up in Prompt 7. |
| VLP staff-facing member app | Tax pro generates a 2848 for a client from the Client Record page. | Wired up in Prompt 7. |

## Contract & route (created in Prompt 7, not yet)

- **Contract:** `contracts/tmp/tmp.tool.2848.v1.json`
- **Route:** `POST /v1/tools/2848/generate` in `workers/src/index.js`
- **Auth:** session required (rate-limited per the `/v1/tools/*` group in CLAUDE.md §15)
- **Token cost:** TBD in Prompt 7

## Dependencies

- `pdf-lib` ^1.17.1 — already present in the repo root `package.json`. No new dependencies required.

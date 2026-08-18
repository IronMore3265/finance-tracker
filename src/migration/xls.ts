/**
 * Reading the old app's `.xls`, and the only file in the app that knows
 * SheetJS exists.
 *
 * Two constraints, both recorded in PROGRESS.md section 5 and both worth
 * repeating where the import actually happens:
 *
 * **The file is legacy BIFF8 (OLE2), written by Apache POI's HSSF.** `exceljs`
 * reads `.xlsx` only and cannot open it at all. SheetJS is the one practical
 * reader, and it is installed **from the official CDN tarball**, not from npm
 * — the npm `xlsx` package is abandoned at 0.18.5 and carries CVE-2023-30533.
 * Check `package.json`: the dependency must stay a `https://cdn.sheetjs.com/`
 * URL. If it is ever "tidied up" into a semver range it silently becomes the
 * vulnerable abandoned package.
 *
 * **It is loaded lazily, and that is load-bearing.** SheetJS is roughly 800kb
 * of parser for a screen most people open once, ever. The `await import()`
 * below is what keeps it out of the initial download, and `vite.config.ts`
 * gives it its own named `sheetjs` chunk so the build output says whether that
 * is still true. If `sheetjs` ever appears in `index.html`'s preload list,
 * something has imported this module's dependency statically and every user is
 * paying for a parser they will never run.
 */
import type {RawSheets} from './parse';

/**
 * Turn a workbook into plain rows keyed by header text.
 *
 * The narrow return type is the point: SheetJS's types stop here, so the rest
 * of the importer is ordinary data and can be tested with object literals.
 */
export async function readWorkbook(data: ArrayBuffer): Promise<RawSheets> {
  const XLSX = await import('xlsx');

  const workbook = XLSX.read(new Uint8Array(data), {
    type: 'array',
    // Date-formatted cells arrive as Date objects rather than Excel serials.
    // The real export writes its dates as text, so this changes nothing for
    // it, but a file from a version that formats them properly parses the same
    // way. `parse.ts` accepts all three forms regardless.
    cellDates: true,
    // No formatted text, no formulas, no styles: none of it is read, and each
    // costs time and memory on a file that may be the user's whole history.
    cellText: false,
    cellNF: false,
    cellStyles: false,
    cellFormula: false,
  });

  const sheets: RawSheets = {};

  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (sheet === undefined) continue;

    sheets[name] = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      // Raw values, not the display strings: `20` rather than `"20.00"`, so
      // amounts do not have to be parsed back out of a locale's formatting.
      raw: true,
      // Present-but-empty cells read as null instead of vanishing, so a row
      // with a blank description keeps the same shape as one without.
      defval: null,
    });
  }

  return sheets;
}

/** Read a picked file. Split out so a caller can hand in bytes from anywhere else. */
export async function readWorkbookFile(file: File): Promise<RawSheets> {
  return readWorkbook(await file.arrayBuffer());
}

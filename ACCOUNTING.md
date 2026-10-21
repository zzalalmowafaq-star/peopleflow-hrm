# HRM and Accounting update

Open **Peopleflow HRM** on your Mac. Your 294 existing employees and account registry are preserved. This remains a local custom application; it is not Odoo and does not yet reproduce every Odoo workflow.

## Start accounting

1. Open the application switcher → **Accounting** → **Set up company**.
2. Enter the legal company name. For payroll integration, use the exact company name already assigned to the employee. Select the country and bookkeeping currency. Afghanistan selects AFN; Uzbekistan selects UZS. Other listed countries and supported currencies are available. Each company has independent books in one currency.
3. A generic chart of accounts and Sales, Purchases, Bank and General journals are created. Review the chart, bank accounts and company details in **Configuration**. These are generic books, not a statutory country localization.
4. Under Configuration, add **Customers & Vendors** and the **Taxes** you need, with your reviewed rates and tax accounts. No statutory rate is assumed.
5. Create customer invoices or vendor bills. Drafts are editable. **Confirm & post** creates a balanced ledger entry and freezes the document. Export CSV, download a PDF, or download printable HTML. PDFs embed a local Noto Sans font for Latin and Cyrillic text; unsupported scripts produce an explicit error so you can use HTML instead.
6. **Register payment** records an existing payment and reduces the document balance, including partial payments. It does not move money. Bank & Cash lets you enter statement transactions and match them to payments with the exact journal, amount and direction. Unmatch before reversing a payment.
7. Corrections use dated reversal entries, preserving the original and audit history. Period locks only move forward. Company details can be saved without setting a lock date.
8. Reporting includes a trial balance, general ledger, profit & loss, balance sheet, aged receivables/payables and configured-tax summary. Reports use posted entries and historical settlement/reversal dates. CSV exports are available.
9. Accounting → Payroll can post finalized **Paid** payslips as payroll expense, salary liability and deduction liability. Company and currency must match. This is an accrual only; settlement is a separate journal entry. A payslip cannot be posted twice to the same books.
10. **Export books** downloads a JSON copy for review/backup. Also back up the complete local `.wrangler/state` directory with the app closed. The source ZIP does not include your business data or credentials.

## HR fixes and additions

- Job cards open applicants for that job. Stage summary buttons filter the selected status. Custom recruitment stages become ordered pipeline columns, with drag-and-drop updates. Recruitment analysis reports application cohorts and sources. Résumés and expense receipts accept PDF/PNG/JPEG files up to 5 MB.
- Working schedules and company public holidays drive expected attendance hours. Completed overnight records split at midnight in the schedule timezone, including DST boundaries. Daily/weekly/monthly date ranges are selectable. Expected hours cover the whole selected period, including future days; extra/short hours are schedule variance, not approved or statutory overtime.
- Approved time off consumes approved entitlement covering the request period. Assigned workdays and public holidays determine duration; employees without a schedule use calendar days. Approval and balance updates commit together, preventing concurrent over-allocation. Approval-level module permission is required for leave/expense decisions; non-administrators cannot approve their own requests. Approved/final record fields are locked.
- Payroll offers reviewed full pay, scheduled-workday proration or recorded-attendance proration. Proration currently requires monthly salary and a period within one month. Paid leave is included, unpaid leave excluded and daily attendance capped at scheduled hours. Calculation inputs are retained on the draft. No automatic statutory payroll taxes are supplied.
- Confirmed/paid calculated payslips now feed administrator payroll reports. Reports identify sources and allow filtering calculated payslips versus the legacy manual register. Combined totals include both sources without deduplication; avoid entering the same pay in both.
- Planning records assign and publish shifts; overlapping published shifts for an employee are rejected. Onboarding/offboarding tasks have owners, due dates and progress. Appraisals include self/manager evaluation and rating; linked 360 feedback can be recorded by administrators.
- Accounting is available to configured accounting users. Module permissions and company scope are enforced at the API as well as in navigation. Administrators retain full access.

## Still different from Odoo

Country selection does **not** install statutory payroll/accounting localization. Afghanistan/Uzbekistan filing, government e-invoices, withholding schemes, social contributions, foreign exchange conversion, bank feeds, OCR, asset depreciation, budgets, consolidation and advanced reconciliation are not implemented. The tax summary is a bookkeeping report, not a filed return.

Recruitment still lacks public careers intake, automated email/survey delivery, offer/signature automation and automatic hire-to-employee conversion. HR still lacks attendance kiosk/badges, approved overtime policies, automatic checkout and notification delivery. Employee self-service and company/team access controls are now available. Shift planning and 360 feedback are manual records, not complete Odoo planning/survey systems.

Dates use the Gregorian calendar and the interface is English. Separate-company currencies are supported; foreign-currency transactions inside one company's books and currency conversion are not.

## Verification

TypeScript and the production build passed. Mocked-storage API and calculation tests cover accounting balance/precision, invoices/taxes, partial payments, payment/document reversals, historical reports, locks, statement matching, permissions and stale writers; HR entitlement/concurrent approvals, attendance timezone/DST splitting, payroll proration and atomic batches; authentication, employee privacy, profile validation and report integration. Mac UI checks confirmed the employee count, accounting setup (including AFN/UZS defaults) and recruitment analysis. The current update also verified Users & Access role presets/company controls, lifecycle plan navigation, credit-note screens and payment-term configuration, preserving the existing company books. No test financial transactions were added to your live books.

Accounting is stored under `accounting/books/`. Payroll writes migrate legacy payroll objects into an atomic `payroll/ledger.json` snapshot on the first successful change. Leave/allocation writes similarly migrate to `operations/leave-ledger.json`. Old source objects remain; updated readers prefer the new snapshots. Do not downgrade to old app code after these migrations without restoring the matching data backup.


## Accounting correctness fixes — 21 October 2026

The four reproduced issues are corrected:
- Receivable/payable control roles cannot be changed. Bank and tax account roles are protected while linked. Draft posting revalidates all required account roles.
- Payment amounts are checked against every outstanding balance from the selected payment date onward, including future recorded payments and reversals. This blocks backdated replacement payments that would overpay a document in a historical period.
- Saved drafts cannot post to archived or mismatched journals. Reactivating the appropriate journal permits posting without recreating the draft.
- Screen and CSV share report rows, statement signs, retained earnings, totals and aging buckets. Balance-sheet dates use the selected as-of date independently of the period start.

All nine test suites passed, including dedicated reproductions of these four issues, and TypeScript and the production build passed. No live financial or employee records were changed by the tests.


## Access, self-service and workflow update - 21 October 2026

### Users & Access Rights

Open Settings to create an account or edit its access. Presets include Administrator, Manager, Viewer, Employee, HR Officer, Payroll Officer and Accountant. Non-administrator roles can be customized by application: None, Read, Write or Approve. Administrators have unrestricted approval access. Scope can be all permitted records, selected companies, the linked employee and reporting team, or the linked employee only. Accounting requires all-record or selected-company scope.

Employee accounts must link an existing employee; an employee can link only one active account. Employee accounts use self scope and cannot edit the directory or access company payroll/accounting. Private bank/identity fields are excluded from ordinary directory responses; payroll users receive the pay-reference fields needed for payroll. CSV bulk employee import currently requires unrestricted employee editing access.

Payroll writers can create/edit pending manual entries; paid entries require approval access. Legacy Manager accounts keep their existing manual-register permissions until their access profile is edited.

Editing an account or revoking sessions invalidates previous sessions. The current administrator session is renewed when editing their own account. Your own administrator account cannot be disabled or demoted. Account changes are audited, and stale edits are rejected. Passwords must have 12-128 characters; no default password is generated or shown. Users change their own password under My Workspace, while administrators can set a new password in the user form.

My Workspace shows the linked employee's own attendance, time off, expenses, shifts, tasks, finalized payslips and appraisal self-evaluation. Users can edit personal contact and emergency details. Manager appraisal feedback is released after completion. Linking an employee to an existing administrator is optional and must be done by the administrator.

### Added options

- Time Off: Days, AM/PM Half day, or Hours. Half-day and hourly requests cover one working day. Hour requests require an assigned working schedule and cannot exceed its daily hours. Different AM/PM requests can coexist; overlapping whole-day/hour requests are conservatively rejected. Approved partial leave reduces entitlement proportionately and feeds payroll proration without counting the same hours twice.
- Onboarding & Offboarding -> Plans & Checklists: reusable company templates with relative day offsets, instructions and up to 50 tasks. Assignments copy the template, preserving existing checklists when a template changes. Tasks have due dates, a default owner and completion status. The assigned employee can complete tasks they own through this screen. Approval permission configures templates; officer-level write access assigns plans.
- Accounting -> Customers / Vendors -> Credit Notes / Vendor Credits: draft and post credits against an original invoice/bill. Aggregate posted credits cannot exceed the original total. Apply a credit against a compatible open invoice/bill, unmatch it with a dated action, or record an actual refund payment. All postings remain balanced; taxes and historical aging include credits.
- Accounting -> Configuration -> Payment Terms: percentages totaling 100%, with due dates measured in days after the document date. Documents retain a snapshot of their installment plan; settlements reduce the oldest installment first. Aging buckets use each installment's remaining balance.
- Accounting -> Bank & Cash -> Import statement CSV: preview up to 500 rows using columns `reference,date,label,amount`. Dates use YYYY-MM-DD; positive signed amounts are receipts and negative amounts withdrawals. References must be distinct within the selected bank journal. A duplicate or invalid row rejects the complete import. Imports create statement rows, not ledger entries or bank transfers; reconciliation still matches exact recorded payments.
- Accounting document details -> Download PDF: multipage invoice, bill and credit PDFs with wrapped item descriptions, totals, currency and payment schedules. Files are generated on your computer. Printable HTML remains available for other scripts.

### Remaining implementation work

The additions above do not complete Odoo parity. The remaining gaps include public recruitment intake, email/survey/offer/signature automation and hiring conversion; leave carry-over and configurable approval routes/types; approved overtime/kiosk/automatic checkout; recurring/open/swap/auto-planned shifts and Gantt; expense report batches, OCR and posting; structured skill libraries; payroll work-entry/attachment/localization engines; invoice email/follow-up automation; partial or multi-item bank matching, bank rules and write-offs; foreign-currency transactions and gains/losses; assets/depreciation, budgets, analytics and consolidation. Government returns and e-invoices require verified rules and integrations for each country. Selecting Afghanistan, Uzbekistan or another country does not configure those legal rules.

The custom application runs on this Mac and does not yet provide a remotely hosted employee portal. Network email, banking and government credentials have not been configured. Multi-country data/currencies are configurable; statutory support is not claimed.

### Validation for this update

Twelve automated suites passed, covering authentication/access isolation, lifecycle plan snapshots and stale updates, credit/refund matching and historical balances, installment schedules, bank CSV atomic validation, PDFs, employee profiles, HR approval workflows, partial leave/payroll calculations and existing reporting. TypeScript and the production build passed. All mutations in automated tests use isolated mock storage, with no test accounts or financial transactions added to live data.

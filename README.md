# Your local HRM

Open http://127.0.0.1:5173 while the HRM server is running.

To start it again, double-click Start-HRM.command in this folder. Keep its Terminal window open. Stop it with Control-C. On first launch, create your administrator username and password (at least 12 characters). Thereafter, sign in with those credentials. Administrators can open Users to create accounts, set Administrator/Manager/Viewer roles, reset passwords, or disable accounts. All accounts share this computer’s HRM records. The old seedy@sites.test sign-in no longer grants access.

The app runs on this computer's loopback address. Employee and payroll records are stored locally under work/hrm-suite/.wrangler/state in the chat's workspace. Do not delete that directory; include it in your backups. This local edition uses password-protected accounts and is intended for use on this computer, not a shared network deployment.

Includes employee records, payroll entries, Paid/Pending tracking, daily/weekly/monthly reporting and CSV exports. No connection to 103.161.236.142:8080 is configured. Payroll deductions are entered manually; this app does not calculate statutory tax or transfer funds.

Verified: the dashboard loads, local storage reads work, daily and weekly date filters work, and TypeScript checks pass. Record creation, validation, authentication and isolation also passed API tests with mocked storage.


## Expanded employee profiles

Five sections: General, Work information, Résumé & skills, Private information, Payroll & HR. Includes employee references, work contacts, company, reporting lines, employment terms, schedule, qualifications, emergency contacts, personal and identification references, salary and bank details. Private profile sections are restricted to administrators; manager edits preserve private information.

Multi-country records support employment country, region, tax residence, payroll jurisdiction, work timezone and international currencies. Select the applicable country per employee. Country-specific tax calculations and statutory compliance certification are not included. Employee document attachments are now supported in the Documents app. This is an Odoo-inspired profile, not full Odoo feature parity.

Validation: TypeScript and mocked-storage API tests passed for private access, field validation, unique employee references, reporting cycles, country and currency selection. Profile tabs were checked in the running browser.

Reference: https://www.odoo.com/documentation/19.0/applications/hr/employees/new_employee.html


## HR workspace expansion

The custom HRM now has a purple application shell, app launcher, employee cards/list/organization views, plus these apps:

- Attendances: manual employee check-in/out records, worked-hour calculation and overlap checks.
- Time Off: requests with calendar-day durations, approval/refusal/cancellation and overlap checks.
- Recruitment: candidate registration, pipeline stages, kanban/list views and interview notes.
- Expenses: expense records, currency, submission/approval and reimbursement tracking.
- Appraisals: review scheduling, goals, feedback and follow-up notes (administrators only).
- Contracts: employment terms, dates, wage references and running-contract overlap checks (administrators only).
- Departments: teams, parent departments, manager assignment, duplicate/cycle validation, and suggestions in employee profiles.
- Documents: employee document records and PDF/PNG/JPEG attachments up to 5 MB (administrators only). Save the document record, then upload from its list row.

Apps include CSV export, search, status filters and activity histories. Managers can work with attendance, leave, recruitment, expenses and departments. Viewers can read attendance, leave and department records but cannot edit them. Recruitment and expenses are restricted to staff; appraisals, contracts and documents are restricted to administrators. Private profile permissions are unchanged.

Data is stored locally in the existing R2 emulator under .wrangler/state. Do not delete that directory. New operational records use operations/ and attachments/ prefixes; existing employee/payroll records and user accounts retain their original keys. Editing a workflow record uses revision checks to reject stale updates.

Validation: production build and TypeScript checks passed. Mock-storage tests passed for authentication, permissions, profile privacy, approval updates, attendance hours/overlap, leave duration/overlap, contract overlap, department cycles, stale revisions, audit history and document uploads/downloads. Browser checks covered the app launcher, recruitment pipeline/form and time-off workspace. No sample employee, candidate or payroll records were added to your live workspace.

This is an independently built Odoo-style HR workspace, not full Odoo feature parity. Payroll is manual; reimbursement statuses do not transfer money. Automatic statutory payroll, leave accruals/holiday calendars, electronic signatures, automated hiring conversion, employee self-service and Odoo integrations remain outside this implementation.


## Bulk employee import

Open Employees → Import employees. Download a basic or full-profile CSV template, fill it in, choose the CSV/TSV file, select Validate & preview, then Import employees. Excel workbooks must first be saved as CSV UTF-8. Limits: 500 employees and 3 MB per file. Dates use YYYY-MM-DD; employment and tax-residence countries use uppercase two-letter country codes.

Required columns: name, employeeNumber, department, role, start. Full templates include optional private.* columns for administrators only. Managers may import professional fields; viewers cannot import. Unknown/duplicate headers, invalid profiles and manager cycles block import. Manager/coach references can use employee numbers from existing employees or the same file.

Imports create new profiles. Existing employee references or non-empty work emails are skipped, never overwritten. Preview does not save records. Validation errors prevent writes. Storage errors during an import are reported by row; successful rows remain saved, and retrying the same file skips existing records. Download results for a row-level report.

Verified: CSV parsing, multiline quoting, TSV/semicolon support, duplicate handling, safe retry, manager links, role/private-column permissions and validation tests passed. Browser preview validated a sample without importing it; no sample employees were saved.


## Accounting and connected HR workflows

The latest accounting setup, HR workflow changes, test coverage and remaining Odoo differences are documented in ACCOUNTING.md. Accounting uses independent company books and configurable taxes; country selection is not statutory localization. Back up the complete local .wrangler/state directory with the app closed. The source ZIP excludes all business data and credentials.


## Attendance device import and overtime — update

**Import device punches** (Attendances → Import Punches). Load the punch log exported from fingerprint or face terminals (CSV, TSV or TXT, up to 60,000 punches / 6 MB per file). Columns are detected automatically: device user ID or employee reference (User ID, AC-No., Badge, No., employeeNumber), a date-time column or separate Date and Time columns, and optionally the In/Out state (Check-In/Check-Out, C/In, C/Out, 0/1 and ZKTeco break/overtime states) and device name. Dates can be YYYY-MM-DD, DD.MM.YYYY or DD/MM/YYYY (month-first can be selected). Employees are matched by the new profile field **Attendance device ID / badge** (Work information), otherwise by employee reference; leading zeros are ignored and a device ID used by two employees is rejected. Device times are read in each employee's schedule timezone, otherwise the timezone chosen on the import screen.

Punches are paired in time order per employee, so night shifts across midnight work. Repeated punches within the rule's duplicate window are ignored. A check-in not closed within the maximum shift length is reported as an exception, or closed at the scheduled daily hours if the overtime rule says so (marked "Auto check-out"). Punches still open within the maximum shift are left for the next import. **Validate & preview** writes nothing. Records identical to existing attendance are skipped as "Already imported", and overlaps with existing records are listed as exceptions, so the same file can be imported again safely. Exceptions can be downloaded as CSV.

**Overtime Rules** (Attendances → Overtime Rules, approval access required). One active rule per company, or one for all companies: tolerance (daily overtime below it is ignored), rounding down (e.g. 15 minutes), pay multipliers for working-day overtime, rest-day work and public-holiday work, maximum shift length, duplicate punch window and missing check-out handling. Multipliers are not preset by law; confirm them with your labour law adviser. Attendance Reporting shows overtime hours by category using the rule.

**Overtime in payroll.** On a payslip or batch, tick **Pay overtime from attendance**. Earnings lines OT_WORKDAY, OT_RESTDAY and OT_HOLIDAY are added using the hourly rate (monthly pay ÷ scheduled hours of that month, or hourly reference pay). Requires a working schedule, an overtime rule for the employee's company and, for monthly pay, a period within one month. Overtime is never paid unless selected.

Verified: `node scripts/test-attendance-import.mjs` (file formats, timezones/DST, night shifts, duplicates, badge matching, missing check-outs, idempotent re-import, permissions, overtime tolerance/rounding/rest days/holidays and payslip amounts) plus all existing suites and TypeScript checks of the app code. Production build must be run on the Mac (the hosting configuration is not included in the source ZIP).

## Leave accrual plans — update

**Accrual Plans** (Time Off → Accrual Plans, approval access to allocations required). A plan sets the leave type, an optional company, how often days are added (monthly or yearly), how many days each period, whether they are added at the start or end of the period, a waiting period in months of service (from the employment start date) and an optional maximum. Example: 1.75 days at the end of each month gives 21 days a year. Amounts are not preset by law; confirm them with your labour law adviser.

**Accrual allocations.** On a Time Off allocation, choose Allocation type **Accrual** and a plan. The allocation keeps a copy of the plan, so editing or archiving a plan never changes existing allocations. Days build up inside the allocation's period: a partial first or last month (or year) is prorated by calendar days, nothing accrues before the employment start date plus the waiting period, and accrual stops at the employment end date. The accrued amount is calculated whenever it is needed, so nothing has to run in the background and closing the app loses nothing.

**Generate accruals** (Time Off → Allocations). Choose a plan, a period, optionally a department, and whether to create the allocations as To approve or Approved. **Preview** writes nothing and lists every employee in your scope with their days for the period, or why they are skipped (already has an allocation of that leave type in the period, left before it, or nothing accrues). **Create** saves all allocations in one step; running it again skips employees who already have one.

**Approvals and balances.** A time-off request can use the days accrued by its first day. Approving it is refused if it would leave a later approved request without enough accrued time. Time Off → Balances shows the days accrued by today and the total by the end of the selected period. Each period needs its own allocation (for example, generate next year's at year end); unused days do not carry over automatically.

Verified: `node scripts/test-leave-accrual.mjs` (monthly/yearly credits, timing, proration, waiting period, maximum, employment dates, plan snapshots, permissions, approvals against accrued days, later-request protection, bulk preview/generation and repeat protection), all 14 test suites, TypeScript and the production build.

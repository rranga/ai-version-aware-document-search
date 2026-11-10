/** Sample documents for demo mode (GitHub Pages without a backend). */
export interface DemoSeed {
  title: string
  source_name: string
  versions: { label: string; date: string; text: string }[]
}

const travelV1 = `# Travel & Expense Policy

## Scope

This policy applies to all employees travelling on company business.

## Approval

All business trips must be approved by your line manager before booking. Trips costing more than 2,000 EUR also require approval from the department head.

## Flights

Economy class is required for all flights. Business class is not reimbursed.

## Hotels

Hotel costs are reimbursed up to 150 EUR per night in all cities.

## Per diem

Employees receive a daily allowance of 40 EUR for meals while travelling.

## Expense claims

Expense claims must be submitted within 60 days of the end of the trip, with original paper receipts attached.`

const travelV2 = `# Travel & Expense Policy

## Scope

This policy applies to all employees and contractors travelling on company business.

## Approval

All business trips must be approved by your line manager before booking. Trips costing more than 2,000 EUR also require approval from the department head.

## Flights

Economy class is required for flights under 6 hours. Business class may be booked for flights longer than 6 hours with department head approval.

## Hotels

Hotel costs are reimbursed up to 150 EUR per night, or 220 EUR per night in London, Paris, New York and Zurich.

## Per diem

Employees receive a daily allowance of 45 EUR for meals while travelling.

## Expense claims

Expense claims must be submitted within 30 days of the end of the trip. Digital photos of receipts are accepted.`

const travelV3 = `# Travel & Expense Policy

## Scope

This policy applies to all employees and contractors travelling on company business.

## Approval

All business trips must be booked through the travel portal, which routes approval to your line manager automatically. Trips costing more than 3,000 EUR also require approval from the department head.

## Flights

Economy class is required for flights under 6 hours. Business class may be booked for flights longer than 6 hours with department head approval.

## Rail

Rail travel is preferred over flights for journeys under 4 hours. First class rail is reimbursed for journeys over 2 hours.

## Hotels

Hotel costs are reimbursed up to 160 EUR per night, or 240 EUR per night in London, Paris, New York and Zurich.

## Per diem

Employees receive a daily allowance of 45 EUR for meals while travelling.

## Expense claims

Expense claims must be submitted within 30 days of the end of the trip. Digital photos of receipts are accepted.`

const warrantyV1 = `# Product Warranty Terms

## Coverage

Every device is covered against manufacturing defects for 12 months from the date of purchase.

## Exclusions

The warranty does not cover accidental damage, water damage, or normal wear of the battery.

## Claims

To make a claim, return the device to the shop where it was purchased together with the receipt. Repairs take up to 21 days.`

const warrantyV2 = `# Product Warranty Terms

## Coverage

Every device is covered against manufacturing defects for 24 months from the date of purchase. Batteries are covered for 12 months if capacity falls below 80%.

## Exclusions

The warranty does not cover accidental damage or water damage.

## Claims

To make a claim, open a request in the online support portal. We send a prepaid shipping label and repairs take up to 10 days. If a repair is not possible, the device is replaced.`

export const DEMO_SEEDS: DemoSeed[] = [
  {
    title: 'Travel & Expense Policy',
    source_name: 'travel-policy.md',
    versions: [
      { label: '2023', date: '2023-01-15T09:00:00Z', text: travelV1 },
      { label: '2024', date: '2024-02-01T09:00:00Z', text: travelV2 },
      { label: '2025', date: '2025-03-10T09:00:00Z', text: travelV3 },
    ],
  },
  {
    title: 'Product Warranty Terms',
    source_name: 'warranty.md',
    versions: [
      { label: 'Launch', date: '2024-05-20T09:00:00Z', text: warrantyV1 },
      { label: 'EU update', date: '2025-06-01T09:00:00Z', text: warrantyV2 },
    ],
  },
]

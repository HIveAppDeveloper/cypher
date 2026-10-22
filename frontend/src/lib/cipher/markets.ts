// Territory Pulse company universe. Snapshot values are illustrative demo
// estimates used only when live sources (SEC EDGAR, Greenhouse) are unreachable.
export interface Company {
  name: string;
  ticker: string;
  domain: string;
  hq: string;
  greenhouse?: string;
  snapshot: { openRoles: number; gtmRoles: number; raisedRecently: boolean; filings90d: number; capexTrend: 'up' | 'flat' | 'down' };
}

export interface Market { id: string; label: string; short: string; blurb: string; companies: Company[] }

const c = (name: string, ticker: string, domain: string, hq: string, greenhouse: string | undefined, openRoles: number, gtmRoles: number, raisedRecently: boolean, filings90d: number, capexTrend: 'up' | 'flat' | 'down'): Company =>
  ({ name, ticker, domain, hq, greenhouse, snapshot: { openRoles, gtmRoles, raisedRecently, filings90d, capexTrend } });

export const MARKETS: Market[] = [
  {
    id: 'fintech', label: 'Fintech & Payments', short: 'Fintech', blurb: 'Neobanks, payments, lending and crypto rails',
    companies: [
      c('Robinhood', 'HOOD', 'robinhood.com', 'Menlo Park, CA', 'robinhood', 212, 31, false, 9, 'up'),
      c('SoFi', 'SOFI', 'sofi.com', 'San Francisco, CA', 'sofi', 318, 44, true, 11, 'up'),
      c('Affirm', 'AFRM', 'affirm.com', 'San Francisco, CA', 'affirm', 164, 22, true, 8, 'up'),
      c('Toast', 'TOST', 'toasttab.com', 'Boston, MA', 'toast', 276, 71, false, 6, 'up'),
      c('Marqeta', 'MQ', 'marqeta.com', 'Oakland, CA', 'marqeta', 58, 9, false, 5, 'flat'),
      c('Coinbase', 'COIN', 'coinbase.com', 'Remote', 'coinbase', 341, 38, true, 14, 'up'),
      c('Block', 'XYZ', 'block.xyz', 'Oakland, CA', undefined, 402, 53, false, 7, 'flat'),
      c('PayPal', 'PYPL', 'paypal.com', 'San Jose, CA', undefined, 520, 61, false, 10, 'flat'),
      c('Upstart', 'UPST', 'upstart.com', 'San Mateo, CA', 'upstart', 71, 8, true, 9, 'up'),
      c('LendingClub', 'LC', 'lendingclub.com', 'San Francisco, CA', 'lendingclub', 64, 11, false, 6, 'flat'),
      c('Bill Holdings', 'BILL', 'bill.com', 'San Jose, CA', 'billcom', 133, 37, false, 5, 'flat'),
      c('Flywire', 'FLYW', 'flywire.com', 'Boston, MA', 'flywire', 92, 26, false, 4, 'up'),
      c('Payoneer', 'PAYO', 'payoneer.com', 'New York, NY', undefined, 118, 19, false, 6, 'up'),
      c('Remitly', 'RELY', 'remitly.com', 'Seattle, WA', undefined, 147, 18, false, 5, 'up'),
      c('Shift4', 'FOUR', 'shift4.com', 'Allentown, PA', undefined, 96, 34, true, 12, 'up'),
      c('Dave', 'DAVE', 'dave.com', 'Los Angeles, CA', 'dave', 41, 4, false, 7, 'flat'),
      c('MoneyLion', 'ML', 'moneylion.com', 'New York, NY', undefined, 38, 6, false, 8, 'down'),
      c('Paymentus', 'PAY', 'paymentus.com', 'Charlotte, NC', undefined, 52, 15, false, 4, 'flat'),
      c('nCino', 'NCNO', 'ncino.com', 'Wilmington, NC', undefined, 109, 28, false, 5, 'flat'),
      c('Q2 Holdings', 'QTWO', 'q2.com', 'Austin, TX', undefined, 87, 21, false, 4, 'flat'),
    ],
  },
  {
    id: 'security', label: 'Cybersecurity', short: 'Security', blurb: 'Identity, endpoint, cloud and network security',
    companies: [
      c('CrowdStrike', 'CRWD', 'crowdstrike.com', 'Austin, TX', undefined, 488, 132, false, 7, 'up'),
      c('Okta', 'OKTA', 'okta.com', 'San Francisco, CA', 'okta', 221, 64, false, 6, 'flat'),
      c('Zscaler', 'ZS', 'zscaler.com', 'San Jose, CA', undefined, 356, 118, false, 5, 'up'),
      c('Cloudflare', 'NET', 'cloudflare.com', 'San Francisco, CA', 'cloudflare', 297, 91, true, 8, 'up'),
      c('SentinelOne', 'S', 'sentinelone.com', 'Mountain View, CA', undefined, 168, 57, false, 6, 'flat'),
      c('Palo Alto Networks', 'PANW', 'paloaltonetworks.com', 'Santa Clara, CA', undefined, 612, 174, false, 9, 'up'),
      c('Fortinet', 'FTNT', 'fortinet.com', 'Sunnyvale, CA', undefined, 433, 121, false, 5, 'up'),
      c('Rapid7', 'RPD', 'rapid7.com', 'Boston, MA', undefined, 94, 29, false, 6, 'down'),
      c('Tenable', 'TENB', 'tenable.com', 'Columbia, MD', undefined, 117, 41, false, 5, 'flat'),
      c('Qualys', 'QLYS', 'qualys.com', 'Foster City, CA', undefined, 76, 18, false, 4, 'flat'),
      c('Varonis', 'VRNS', 'varonis.com', 'New York, NY', undefined, 131, 48, true, 7, 'flat'),
      c('CyberArk', 'CYBR', 'cyberark.com', 'Newton, MA', undefined, 204, 63, true, 8, 'up'),
      c('Check Point', 'CHKP', 'checkpoint.com', 'Tel Aviv, IL', undefined, 189, 52, false, 3, 'flat'),
      c('Akamai', 'AKAM', 'akamai.com', 'Cambridge, MA', undefined, 248, 59, false, 6, 'up'),
      c('Gen Digital', 'GEN', 'gendigital.com', 'Tempe, AZ', undefined, 143, 22, false, 5, 'flat'),
      c('OneSpan', 'OSPN', 'onespan.com', 'Boston, MA', undefined, 34, 11, false, 4, 'down'),
      c('SailPoint', 'SAIL', 'sailpoint.com', 'Austin, TX', undefined, 176, 58, true, 10, 'up'),
      c('Netskope', 'NTSK', 'netskope.com', 'Santa Clara, CA', undefined, 212, 77, true, 13, 'up'),
      c('Rubrik', 'RBRK', 'rubrik.com', 'Palo Alto, CA', 'rubrik', 239, 86, true, 9, 'up'),
      c('Commvault', 'CVLT', 'commvault.com', 'Tinton Falls, NJ', undefined, 121, 39, false, 5, 'flat'),
    ],
  },
  {
    id: 'devtools', label: 'Cloud & DevTools', short: 'DevTools', blurb: 'Data, observability, developer platforms',
    companies: [
      c('Datadog', 'DDOG', 'datadoghq.com', 'New York, NY', 'datadog', 402, 118, false, 6, 'up'),
      c('MongoDB', 'MDB', 'mongodb.com', 'New York, NY', 'mongodb', 318, 103, false, 7, 'up'),
      c('Elastic', 'ESTC', 'elastic.co', 'San Francisco, CA', 'elastic', 197, 62, false, 5, 'flat'),
      c('GitLab', 'GTLB', 'gitlab.com', 'Remote', 'gitlab', 154, 49, false, 6, 'flat'),
      c('Snowflake', 'SNOW', 'snowflake.com', 'Bozeman, MT', undefined, 538, 161, true, 9, 'up'),
      c('HashiCorp (IBM)', 'IBM', 'hashicorp.com', 'San Francisco, CA', undefined, 88, 21, false, 4, 'flat'),
      c('Confluent', 'CFLT', 'confluent.io', 'Mountain View, CA', undefined, 172, 58, false, 6, 'flat'),
      c('DigitalOcean', 'DOCN', 'digitalocean.com', 'New York, NY', 'digitalocean98', 79, 17, true, 8, 'up'),
      c('Twilio', 'TWLO', 'twilio.com', 'San Francisco, CA', 'twilio', 211, 66, false, 7, 'flat'),
      c('Atlassian', 'TEAM', 'atlassian.com', 'Sydney, AU', undefined, 446, 87, false, 6, 'up'),
      c('JFrog', 'FROG', 'jfrog.com', 'Sunnyvale, CA', undefined, 103, 31, false, 4, 'up'),
      c('Dynatrace', 'DT', 'dynatrace.com', 'Waltham, MA', undefined, 238, 79, false, 5, 'up'),
      c('Samsara', 'IOT', 'samsara.com', 'San Francisco, CA', 'samsara', 336, 124, false, 6, 'up'),
      c('Fastly', 'FSLY', 'fastly.com', 'San Francisco, CA', 'fastly', 61, 17, true, 8, 'down'),
      c('Couchbase', 'BASE', 'couchbase.com', 'Santa Clara, CA', undefined, 47, 15, false, 9, 'flat'),
      c('Braze', 'BRZE', 'braze.com', 'New York, NY', 'braze', 158, 52, false, 5, 'up'),
      c('Asana', 'ASAN', 'asana.com', 'San Francisco, CA', 'asana', 112, 33, false, 5, 'flat'),
      c('Klaviyo', 'KVYO', 'klaviyo.com', 'Boston, MA', 'klaviyo', 247, 71, false, 6, 'up'),
      c('Doximity', 'DOCS', 'doximity.com', 'San Francisco, CA', 'doximity', 68, 13, false, 4, 'flat'),
      c('Freshworks', 'FRSH', 'freshworks.com', 'San Mateo, CA', undefined, 188, 72, false, 5, 'flat'),
    ],
  },
];

export const PERSONAS = ['VP of Sales', 'Chief Revenue Officer', 'Head of RevOps', 'VP Marketing', 'Head of Growth'] as const;

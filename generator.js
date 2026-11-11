/* Synthetic talabat consumer-survey generator.
   One respondent = one answered questionnaire (columns match the variable map in the questionnaire doc).
   Fields starting with "_" are simulation-only truth (never exported to CSV). */
(function (root) {
  'use strict';

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function Rng(seed) { this.u = mulberry32(seed >>> 0); this._spare = null; }
  Rng.prototype.normal = function (m, s) {
    if (this._spare !== null) { var v = this._spare; this._spare = null; return (m || 0) + (s === undefined ? 1 : s) * v; }
    var u1 = 0, u2 = 0;
    while (u1 === 0) u1 = this.u();
    u2 = this.u();
    var r = Math.sqrt(-2 * Math.log(u1));
    this._spare = r * Math.sin(2 * Math.PI * u2);
    return (m || 0) + (s === undefined ? 1 : s) * r * Math.cos(2 * Math.PI * u2);
  };
  Rng.prototype.bern = function (p) { return this.u() < p ? 1 : 0; };
  Rng.prototype.pick = function (items, weights) {
    var tot = 0, i;
    for (i = 0; i < weights.length; i++) tot += Math.max(0, weights[i]);
    var r = this.u() * tot;
    for (i = 0; i < weights.length; i++) { r -= Math.max(0, weights[i]); if (r <= 0) return items[i]; }
    return items[items.length - 1];
  };
  Rng.prototype.poisson = function (lam) {
    if (lam > 30) return Math.max(0, Math.round(this.normal(lam, Math.sqrt(lam))));
    var L = Math.exp(-lam), k = 0, p = 1;
    do { k++; p *= this.u(); } while (p > L);
    return k - 1;
  };
  Rng.prototype.binomial = function (n, p) { var k = 0; for (var i = 0; i < n; i++) k += this.bern(p); return k; };

  function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
  function clip(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function bucket(x, cuts) { var i = 0; while (i < cuts.length && x > cuts[i]) i++; return i; }
  // Standard normal CDF (Abramowitz-Stegun 7.1.26 via erf)
  function phi(z) {
    var t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z / 2);
    return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
  }

  var C = {
    countries: ['UAE', 'Kuwait', 'Qatar', 'Bahrain', 'Oman', 'Jordan', 'Egypt', 'Iraq'],
    countryW: [0.38, 0.14, 0.10, 0.05, 0.05, 0.06, 0.15, 0.07],
    ages: ['18-24', '25-34', '35-44', '45-54', '55+'],
    ageW: [0.22, 0.36, 0.24, 0.12, 0.06],
    genders: ['Male', 'Female', 'Prefer not to say'],
    genderW: [0.52, 0.45, 0.03],
    households: ['Living alone', 'Couple', 'Family with children', 'Shared accommodation'],
    incomes: ['<5k', '5k-10k', '10k-20k', '20k-35k', '35k+'],
    occupations: ['Student', 'Employed', 'Self-employed', 'Homemaker', 'Other'],
    proStatus: ['Current', 'Former', 'Never'],
    offers: ['Free delivery', 'Percentage discount', 'Cashback/rewards', 'Pro free trial', 'Bundle deals', 'None'],
    groceryFreq: ['Every 1-3 days', 'Weekly', 'Every 2 weeks', 'Monthly or less'],
    improvements: ['Faster delivery', 'Lower fees', 'Better discounts', 'More restaurants', 'Better grocery range', 'Better support'],
    services: [
      ['int_food_delivery', 'Restaurant food'],
      ['int_mart_grocery', 'talabat mart groceries'],
      ['int_pharmacy', 'Pharmacy & health'],
      ['int_fresh_produce', 'Fresh produce, meat & fish'],
      ['int_flowers_gifts', 'Flowers & gifts'],
      ['int_electronics', 'Electronics'],
      ['int_pet_supplies', 'Pet supplies'],
      ['int_beauty', 'Beauty & personal care'],
      ['int_dineout_deals', 'Dine-out deals'],
      ['int_pickup', 'Pick-up']
    ]
  };
  var HH_BY_AGE = [
    [0.25, 0.08, 0.05, 0.62],
    [0.30, 0.25, 0.25, 0.20],
    [0.15, 0.20, 0.58, 0.07],
    [0.12, 0.25, 0.58, 0.05],
    [0.15, 0.45, 0.37, 0.03]
  ];
  var OCC_BY_AGE = [
    [0.55, 0.35, 0.04, 0.03, 0.03],
    [0.04, 0.74, 0.12, 0.07, 0.03],
    [0.00, 0.68, 0.16, 0.12, 0.04],
    [0.00, 0.62, 0.18, 0.14, 0.06],
    [0.00, 0.40, 0.20, 0.16, 0.24]
  ];
  var COUNTRY_INC = { UAE: 0.4, Kuwait: 0.5, Qatar: 0.6, Bahrain: 0.2, Oman: 0.1, Jordan: -0.5, Egypt: -0.8, Iraq: -0.6 };
  var LOW_PPP = { Jordan: 1, Egypt: 1, Iraq: 1 };
  var KEETA = { UAE: 1, Kuwait: 1, Qatar: 1 };
  var GF_BY_HH = [
    [0.15, 0.40, 0.25, 0.20],
    [0.20, 0.50, 0.20, 0.10],
    [0.35, 0.45, 0.15, 0.05],
    [0.25, 0.40, 0.20, 0.15]
  ];
  var BASE_DATE = Date.UTC(2026, 9, 1, 6, 0, 0); // 1 Oct 2026

  /* params: { keetaPromo, serviceIssues, ramadan } scenario shocks applied to new respondents */
  function respondent(rng, id, timeMs, params) {
    params = params || {};
    var promo = params.keetaPromo ? 1 : 0, issuesShock = params.serviceIssues ? 1 : 0, ramadan = params.ramadan ? 1 : 0;
    var r = {};
    r.respondent_id = 'R' + String(id).padStart(5, '0');
    r.response_time = new Date(timeMs).toISOString().slice(0, 19).replace('T', ' ');

    var country = rng.pick(C.countries, C.countryW);
    var ageIdx = C.ages.indexOf(rng.pick(C.ages, C.ageW));
    var gender = rng.pick(C.genders, C.genderW);
    var hhIdx = C.households.indexOf(rng.pick(C.households, HH_BY_AGE[ageIdx]));
    var occW = OCC_BY_AGE[ageIdx].slice(); if (gender === 'Male') occW[3] *= 0.15;
    var occ = rng.pick(C.occupations, occW);
    var fam = hhIdx === 2 ? 1 : 0, couple = hhIdx === 1 ? 1 : 0, alone = hhIdx === 0 ? 1 : 0;
    var student = occ === 'Student' ? 1 : 0;

    var incLatent = COUNTRY_INC[country] + [-0.6, 0, 0.35, 0.5, 0.3][ageIdx] +
      ({ Student: -0.9, Employed: 0.1, 'Self-employed': 0.3, Homemaker: -0.2, Other: -0.3 })[occ] +
      0.2 * fam + rng.normal(0, 0.7);
    var incIdx = bucket(incLatent, [-0.9, -0.2, 0.5, 1.2]);

    r.country = country; r.age_group = C.ages[ageIdx]; r.gender = gender;
    r.household = C.households[hhIdx]; r.income_band = C.incomes[incIdx]; r.occupation = occ;

    // latent traits
    var e = 0.35 * (ageIdx === 1) + 0.25 * (ageIdx === 0) - 0.3 * (ageIdx >= 3) + 0.25 * fam + 0.15 * alone +
      0.12 * (incIdx - 2) + rng.normal(0, 1);
    var p = -0.3 * (incIdx - 2) + 0.5 * student + 0.2 * (ageIdx === 0) + rng.normal(0, 1) + 0.4 * promo;

    // C: ordering behaviour (RFM)
    var orders = clip(rng.poisson(Math.exp(1.35 + 0.45 * e + 0.15 * ramadan)), 0, 45);
    var rec = orders > 0 ? Math.round(-Math.log(1 - rng.u()) * 30 / (orders + 0.4)) : 30 + Math.round(-Math.log(1 - rng.u()) * 45);
    r.recency_days = clip(rec, 0, 180);
    r.orders_per_month = orders;
    var aov = 48 * Math.exp(0.12 * (incIdx - 2) + 0.25 * fam + 0.1 * couple - 0.1 * student + rng.normal(0, 0.25));
    if (LOW_PPP[country]) aov *= 0.6;
    r.avg_order_value_aed = Math.round(clip(aov, 15, 260));
    r.talabat_monthly_spend_aed = r.orders_per_month * r.avg_order_value_aed;

    var pro = rng.bern(sigmoid(-1.4 + 0.75 * e + 0.25 * (incIdx - 2) - 0.15 * p)) ;
    r.pro_status = pro ? 'Current' : (rng.bern(0.18) ? 'Former' : 'Never');
    var martLatent = -0.6 + 0.6 * fam + 0.25 * couple + 0.4 * e + 0.4 * pro + rng.normal(0, 1) + 0.3 * ramadan;
    r.used_food = rng.bern(0.96);
    r.used_mart = martLatent > 0.3 ? 1 : 0;
    r.used_pharmacy = rng.bern(sigmoid(-1.6 + 0.4 * fam + 0.3 * (ageIdx >= 3) + 0.3 * e));

    r.uses_keeta = rng.bern(sigmoid(-1.0 + 0.7 * p + 0.3 * (ageIdx <= 1) - 0.5 * pro + 1.0 * promo + (KEETA[country] ? 0 : -2.2)));
    r.uses_careem = rng.bern(sigmoid(-1.2 + 0.2 * e + (country === 'UAE' ? 0.6 : -0.5)));
    r.uses_deliveroo = rng.bern(sigmoid(-1.0 + (KEETA[country] ? 0.4 : -2.5) + 0.2 * (incIdx - 2)));
    r.uses_noon = rng.bern(sigmoid(-1.6 + (country === 'UAE' ? 0.5 : -2.5)));
    r.other_apps_count = r.uses_keeta + r.uses_careem + r.uses_deliveroo + r.uses_noon;
    r.talabat_share_pct = Math.round(clip(100 * sigmoid(1.6 - 0.55 * r.other_apps_count + 0.4 * pro + 0.3 * e + rng.normal(0, 0.5)), 5, 100));

    // D: experience and loyalty
    var issues = Math.min(3, rng.poisson((0.45 + 0.03 * orders) * (issuesShock ? 2.2 : 1)));
    var s = 0.3 * e - 0.55 * issues + 0.3 * pro + rng.normal(0, 0.8) - 0.4 * issuesShock;
    r.satisfaction = bucket(s, [-1.6, -0.9, -0.1, 0.8]) + 1;
    r.delivery_speed_rating = clip(Math.round(r.satisfaction + rng.normal(0, 0.8) - 0.3 * issues + 0.2), 1, 5);
    r.issues_3m = issues;

    // E: price sensitivity
    r.discount_importance = clip(Math.round(3 + 1.0 * p + rng.normal(0, 0.6)), 1, 5);
    r.voucher_orders_of_10 = rng.binomial(10, sigmoid(-0.6 + 0.9 * p - 0.6 * pro));

    // G1: churn intent (Problem 1 target)
    var sZ = (r.satisfaction - 3) / 1.1;
    var c = -0.9 * sZ + 0.7 * r.uses_keeta + 0.45 * p + 0.35 * issues - 0.8 * pro - 0.45 * e +
      0.2 * r.other_apps_count - 0.008 * (r.talabat_share_pct - 60) + 0.35 * promo + rng.normal(0, 0.8);
    r.churn_intent = bucket(c, [-1.5, -0.4, 1.0, 1.9]) + 1;
    r.churn_risk = r.churn_intent >= 4 ? 1 : 0;
    r.nps = clip(Math.round(6 + 1.6 * (r.satisfaction - 3) - 0.8 * (r.churn_intent - 3) + rng.normal(0, 1.3)), 0, 10);

    // E3: randomised voucher scenario (built-in A/B test)
    var treated = rng.bern(0.5);
    var b = -0.3 + 0.6 * e + 0.35 * pro - 0.25 * (r.churn_intent - 3) - 0.004 * r.recency_days;
    var tau = 0.15 + (p > 0 ? 0.65 * p : 0.08 * p) - 0.2 * pro - 0.2 * (e > 1 ? 1 : 0) - 0.5 * ((incIdx >= 4 && p < -1.0) ? 1 : 0);
    var noiseSd = 0.9;
    var intentLatent = b + (treated ? tau : 0) + rng.normal(0, noiseSd);
    r.scenario_group = treated ? 'B_voucher' : 'A_control';
    r.scenario_order_intent = bucket(intentLatent, [-1.5, -0.5, 0.4, 1.2]) + 1;
    r.scenario_converted = r.scenario_order_intent >= 4 ? 1 : 0;
    r._true_uplift = phi((b + tau - 0.4) / noiseSd) - phi((b - 0.4) / noiseSd);

    r.preferred_offer = rng.pick(C.offers, [
      0.30 + 0.10 * (pro ? 0 : 1),
      0.18 + 0.12 * Math.max(p, 0),
      0.14 + 0.05 * (incIdx >= 3),
      0.10 + 0.10 * (!pro && e > 0),
      0.12 + 0.08 * fam,
      0.06 + 0.10 * (p < -1)
    ]);

    // F1: interest in 10 services (association rules)
    var female = gender === 'Female' ? 1 : 0, male = gender === 'Male' ? 1 : 0;
    var it = {};
    it.int_food_delivery = rng.bern(Math.min(0.97, 0.86 + 0.06 * (e > 0)));
    it.int_mart_grocery = (martLatent + rng.normal(0, 0.6)) > 0.1 ? 1 : 0;
    it.int_fresh_produce = rng.bern(it.int_mart_grocery ? 0.60 + 0.12 * fam : 0.11 + 0.05 * fam);
    it.int_pharmacy = rng.bern(sigmoid(-1.1 + 0.5 * fam + 0.35 * (ageIdx >= 3) + 0.6 * r.used_pharmacy + 0.4 * it.int_mart_grocery));
    it.int_beauty = rng.bern(sigmoid(-1.4 + 1.1 * female + 0.6 * it.int_pharmacy + 0.2 * (incIdx - 2)));
    it.int_flowers_gifts = rng.bern(sigmoid(-2.2 + 0.9 * it.int_beauty + 0.35 * (incIdx - 2) + 0.3 * couple));
    it.int_electronics = rng.bern(sigmoid(-1.7 + 0.8 * male + 0.4 * (ageIdx <= 1) + 0.25 * (incIdx - 2)));
    it.int_pet_supplies = rng.bern(it.int_mart_grocery && it.int_fresh_produce ? 0.42 : (it.int_mart_grocery ? 0.18 : 0.06));
    it.int_dineout_deals = rng.bern(sigmoid(-0.9 + 0.7 * p + 0.4 * (ageIdx <= 1) + 0.4 * it.int_food_delivery));
    it.int_pickup = rng.bern(it.int_dineout_deals ? 0.50 + 0.10 * (p > 0) : 0.12);
    var nServices = 0;
    for (var k = 0; k < C.services.length; k++) { r[C.services[k][0]] = it[C.services[k][0]]; nServices += it[C.services[k][0]]; }

    // G2-G5: pro, mart intent, grocery habits
    var proInt = 0.5 * e + 0.03 * orders + 0.8 * pro - 0.2 * (r.pro_status === 'Former') + 0.25 * p + rng.normal(0, 0.9);
    r.pro_interest = bucket(proInt, [-1.0, -0.2, 0.6, 1.3]) + 1;
    r.pro_max_fee_aed = 10 * clip(Math.round(1.6 + 0.8 * (r.pro_interest - 3) + 0.4 * (incIdx - 2) + rng.normal(0, 0.8)), 0, 5);
    var gfW = GF_BY_HH[hhIdx].slice();
    if (ramadan) { gfW[0] += 0.12; gfW[1] += 0.05; }
    var gfIdx = C.groceryFreq.indexOf(rng.pick(C.groceryFreq, gfW));
    r.grocery_frequency = C.groceryFreq[gfIdx];
    var mi = -0.9 + 1.1 * it.int_mart_grocery + 0.7 * r.used_mart + 0.35 * fam + 0.3 * (1.5 - gfIdx) / 1.5 +
      0.3 * pro + 0.2 * e + rng.normal(0, 0.8) + 0.35 * ramadan;
    r.mart_order_intent = bucket(mi, [-1.0, -0.2, 0.6, 1.3]) + 1;
    r.mart_interested = r.mart_order_intent >= 4 ? 1 : 0;

    // H: spending
    var groc = [900, 1600, 3000, 800][hhIdx] * Math.exp(0.15 * (incIdx - 2) + rng.normal(0, 0.25));
    if (LOW_PPP[country]) groc *= 0.55;
    r.monthly_grocery_spend_aed = Math.round(groc / 10) * 10;
    r.grocery_shift_pct = Math.round(clip(100 * sigmoid(-1.2 + 0.4 * (r.mart_order_intent - 3) + 0.5 * r.used_mart + 0.2 * e + rng.normal(0, 0.6)), 0, 100));
    var allApps = r.talabat_monthly_spend_aed / (r.talabat_share_pct / 100) * (1 + rng.normal(0, 0.08));
    r.monthly_food_delivery_spend_aed = Math.round(Math.max(r.talabat_monthly_spend_aed, allApps) / 10) * 10;
    var willing = r.talabat_monthly_spend_aed * (1.05 + 0.1 * (r.satisfaction - 3)) +
      r.monthly_grocery_spend_aed * (r.grocery_shift_pct / 100) * 0.6 +
      25 * nServices + 40 * pro + 20 * (incIdx - 2);
    willing = Math.max(20, willing * Math.exp(rng.normal(0, 0.18)) * (ramadan ? 1.08 : 1));
    r.willing_monthly_spend_aed = Math.round(willing / 10) * 10;

    r.top_improvement = rng.pick(C.improvements, [
      0.20 + 0.15 * (issues >= 2), 0.20 + 0.10 * (p > 0), 0.15 + 0.15 * (p > 0.5),
      0.15, 0.10 + 0.15 * it.int_mart_grocery, 0.08 + 0.12 * (issues >= 2)
    ]);
    return r;
  }

  var COLUMNS = ['respondent_id', 'response_time', 'country', 'age_group', 'gender', 'household', 'income_band', 'occupation',
    'recency_days', 'orders_per_month', 'avg_order_value_aed', 'talabat_monthly_spend_aed', 'used_food', 'used_mart', 'used_pharmacy',
    'pro_status', 'uses_keeta', 'uses_careem', 'uses_deliveroo', 'uses_noon', 'other_apps_count', 'talabat_share_pct',
    'satisfaction', 'delivery_speed_rating', 'issues_3m', 'nps', 'discount_importance', 'voucher_orders_of_10',
    'scenario_group', 'scenario_order_intent', 'scenario_converted', 'preferred_offer'
  ].concat(C.services.map(function (s) { return s[0]; })).concat([
    'churn_intent', 'churn_risk', 'pro_interest', 'pro_max_fee_aed', 'mart_order_intent', 'mart_interested', 'grocery_frequency',
    'monthly_food_delivery_spend_aed', 'monthly_grocery_spend_aed', 'grocery_shift_pct', 'willing_monthly_spend_aed', 'top_improvement']);

  /* Seed dataset: n respondents spread over 1 Oct - 10 Nov 2026 */
  function seedDataset(n, seed) {
    var rng = new Rng(seed);
    var span = 40 * 24 * 3600 * 1000, out = [];
    for (var i = 0; i < n; i++) out.push(respondent(rng, i + 1, BASE_DATE + Math.floor(span * (i / n)) + Math.floor(rng.u() * 3600000), {}));
    return out;
  }

  function toCSV(rows) {
    var lines = [COLUMNS.join(',')];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i], vals = [];
      for (var j = 0; j < COLUMNS.length; j++) {
        var v = row[COLUMNS[j]];
        v = v === undefined || v === null ? '' : String(v);
        if (/[",\n]/.test(v)) v = '"' + v.replace(/"/g, '""') + '"';
        vals.push(v);
      }
      lines.push(vals.join(','));
    }
    return lines.join('\n');
  }

  var api = { Rng: Rng, respondent: respondent, seedDataset: seedDataset, toCSV: toCSV, COLUMNS: COLUMNS, C: C, sigmoid: sigmoid };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TalabatGen = api;
})(this);

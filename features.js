/* Feature definitions: which survey answers feed which model. */
(function (root) {
  'use strict';
  var G = root.TalabatGen || (typeof require !== 'undefined' ? require('./generator.js') : null);
  var AGES = G.C.ages, INC = G.C.incomes, GF = G.C.groceryFreq;
  function svcCount(r) { var s = 0; for (var i = 0; i < G.C.services.length; i++) s += r[G.C.services[i][0]]; return s; }
  var f = {
    age: { key: 'age', label: 'Age group', get: function (r) { return AGES.indexOf(r.age_group); } },
    income: { key: 'income', label: 'Income band', get: function (r) { return INC.indexOf(r.income_band); } },
    family: { key: 'family', label: 'Family with children', get: function (r) { return r.household === 'Family with children' ? 1 : 0; } },
    alone: { key: 'alone', label: 'Lives alone', get: function (r) { return r.household === 'Living alone' ? 1 : 0; } },
    student: { key: 'student', label: 'Student', get: function (r) { return r.occupation === 'Student' ? 1 : 0; } },
    recency: { key: 'recency', label: 'Days since last order', get: function (r) { return r.recency_days; } },
    orders: { key: 'orders', label: 'Orders per month', get: function (r) { return r.orders_per_month; } },
    aov: { key: 'aov', label: 'Avg order value', get: function (r) { return r.avg_order_value_aed; } },
    spend: { key: 'spend', label: 'Monthly talabat spend', get: function (r) { return r.talabat_monthly_spend_aed; } },
    pro: { key: 'pro', label: 'talabat pro member', get: function (r) { return r.pro_status === 'Current' ? 1 : 0; } },
    proFormer: { key: 'proFormer', label: 'Former pro member', get: function (r) { return r.pro_status === 'Former' ? 1 : 0; } },
    usedMart: { key: 'usedMart', label: 'Uses talabat mart', get: function (r) { return r.used_mart; } },
    keeta: { key: 'keeta', label: 'Also uses Keeta', get: function (r) { return r.uses_keeta; } },
    otherApps: { key: 'otherApps', label: 'Other apps used', get: function (r) { return r.other_apps_count; } },
    share: { key: 'share', label: 'Share of orders on talabat', get: function (r) { return r.talabat_share_pct; } },
    satisfaction: { key: 'satisfaction', label: 'Satisfaction', get: function (r) { return r.satisfaction; } },
    speed: { key: 'speed', label: 'Delivery speed rating', get: function (r) { return r.delivery_speed_rating; } },
    issues: { key: 'issues', label: 'Late or wrong orders (3m)', get: function (r) { return r.issues_3m; } },
    discountImp: { key: 'discountImp', label: 'Discount importance', get: function (r) { return r.discount_importance; } },
    voucherOrders: { key: 'voucherOrders', label: 'Voucher orders (of 10)', get: function (r) { return r.voucher_orders_of_10; } },
    groceryFreq: { key: 'groceryFreq', label: 'Grocery shopping frequency', get: function (r) { return 3 - GF.indexOf(r.grocery_frequency); } },
    grocerySpend: { key: 'grocerySpend', label: 'Monthly grocery spend', get: function (r) { return r.monthly_grocery_spend_aed; } },
    groceryShift: { key: 'groceryShift', label: 'Grocery share movable to app', get: function (r) { return r.grocery_shift_pct; } },
    martIntent: { key: 'martIntent', label: 'talabat mart intent', get: function (r) { return r.mart_order_intent; } },
    services: { key: 'services', label: 'Services of interest', get: svcCount },
    fresh: { key: 'fresh', label: 'Wants fresh produce', get: function (r) { return r.int_fresh_produce; } },
    pet: { key: 'pet', label: 'Wants pet supplies', get: function (r) { return r.int_pet_supplies; } },
    pharmacyInt: { key: 'pharmacyInt', label: 'Wants pharmacy', get: function (r) { return r.int_pharmacy; } }
  };
  var sets = {
    churn: ['age', 'income', 'family', 'student', 'recency', 'orders', 'aov', 'pro', 'proFormer', 'usedMart', 'keeta', 'otherApps', 'share', 'satisfaction', 'speed', 'issues', 'discountImp', 'voucherOrders'],
    mart: ['age', 'income', 'family', 'alone', 'orders', 'pro', 'usedMart', 'groceryFreq', 'grocerySpend', 'fresh', 'pet', 'pharmacyInt', 'satisfaction', 'discountImp'],
    uplift: ['discountImp', 'voucherOrders', 'pro', 'orders', 'recency', 'income', 'age', 'keeta', 'satisfaction', 'student'],
    spend: ['income', 'family', 'alone', 'age', 'orders', 'aov', 'spend', 'pro', 'satisfaction', 'services', 'grocerySpend', 'martIntent', 'groceryShift', 'discountImp']
  };
  var api = { f: f, sets: sets, get: function (name) { return sets[name].map(function (k) { return f[k]; }); }, svcCount: svcCount };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Features = api;
})(this);

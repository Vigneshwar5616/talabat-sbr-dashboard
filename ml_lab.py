"""Python versions of the dashboard's algorithms, run on the survey CSV.

Clustering (K-means), classification (logistic regression, decision tree, gradient boosting, XGBoost),
association rules (Apriori), regression (linear, gradient boosting, XGBoost), A/B testing and two-model uplift.
Column names follow the questionnaire's variable map.
"""
from __future__ import annotations

from itertools import combinations
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats
from sklearn.cluster import KMeans
from sklearn.ensemble import GradientBoostingClassifier, GradientBoostingRegressor
from sklearn.linear_model import LinearRegression, LogisticRegression
from sklearn.metrics import (accuracy_score, f1_score, mean_absolute_error, mean_squared_error, precision_score,
                             r2_score, recall_score, roc_auc_score, roc_curve, silhouette_score)
from sklearn.model_selection import train_test_split
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.tree import DecisionTreeClassifier

try:  # XGBoost is in requirements.txt; fall back to scikit-learn's histogram booster if it is missing
    from xgboost import XGBClassifier, XGBRegressor
    HAS_XGB = True
except Exception:  # pragma: no cover
    from sklearn.ensemble import HistGradientBoostingClassifier as XGBClassifier  # type: ignore
    from sklearn.ensemble import HistGradientBoostingRegressor as XGBRegressor  # type: ignore
    HAS_XGB = False

DATA_PATH = Path(__file__).parent / "talabat_survey_synthetic_1500.csv"
AGES = ["18-24", "25-34", "35-44", "45-54", "55+"]
INCOMES = ["<5k", "5k-10k", "10k-20k", "20k-35k", "35k+"]
GROCERY_FREQ = ["Every 1-3 days", "Weekly", "Every 2 weeks", "Monthly or less"]
SERVICES = {
    "int_food_delivery": "Restaurant food", "int_mart_grocery": "talabat mart groceries", "int_pharmacy": "Pharmacy & health",
    "int_fresh_produce": "Fresh produce, meat & fish", "int_flowers_gifts": "Flowers & gifts", "int_electronics": "Electronics",
    "int_pet_supplies": "Pet supplies", "int_beauty": "Beauty & personal care", "int_dineout_deals": "Dine-out deals", "int_pickup": "Pick-up",
}
REQUIRED = ["recency_days", "orders_per_month", "avg_order_value_aed", "talabat_monthly_spend_aed", "churn_risk", "mart_interested",
            "scenario_group", "scenario_converted", "scenario_order_intent", "willing_monthly_spend_aed"] + list(SERVICES)

# Survey answer -> model input, mirroring features.js in the live dashboard
FEATURES = {
    "age": ("Age group", lambda d: d["age_group"].map({a: i for i, a in enumerate(AGES)})),
    "income": ("Income band", lambda d: d["income_band"].map({a: i for i, a in enumerate(INCOMES)})),
    "family": ("Family with children", lambda d: (d["household"] == "Family with children").astype(int)),
    "alone": ("Lives alone", lambda d: (d["household"] == "Living alone").astype(int)),
    "student": ("Student", lambda d: (d["occupation"] == "Student").astype(int)),
    "recency": ("Days since last order", lambda d: d["recency_days"]),
    "orders": ("Orders per month", lambda d: d["orders_per_month"]),
    "aov": ("Avg order value", lambda d: d["avg_order_value_aed"]),
    "spend": ("Monthly talabat spend", lambda d: d["talabat_monthly_spend_aed"]),
    "pro": ("talabat pro member", lambda d: (d["pro_status"] == "Current").astype(int)),
    "proFormer": ("Former pro member", lambda d: (d["pro_status"] == "Former").astype(int)),
    "usedMart": ("Uses talabat mart", lambda d: d["used_mart"]),
    "keeta": ("Also uses Keeta", lambda d: d["uses_keeta"]),
    "otherApps": ("Other apps used", lambda d: d["other_apps_count"]),
    "share": ("Share of orders on talabat", lambda d: d["talabat_share_pct"]),
    "satisfaction": ("Satisfaction", lambda d: d["satisfaction"]),
    "speed": ("Delivery speed rating", lambda d: d["delivery_speed_rating"]),
    "issues": ("Late or wrong orders (3m)", lambda d: d["issues_3m"]),
    "discountImp": ("Discount importance", lambda d: d["discount_importance"]),
    "voucherOrders": ("Voucher orders (of 10)", lambda d: d["voucher_orders_of_10"]),
    "groceryFreq": ("Grocery shopping frequency", lambda d: 3 - d["grocery_frequency"].map({a: i for i, a in enumerate(GROCERY_FREQ)})),
    "grocerySpend": ("Monthly grocery spend", lambda d: d["monthly_grocery_spend_aed"]),
    "groceryShift": ("Grocery share movable to app", lambda d: d["grocery_shift_pct"]),
    "martIntent": ("talabat mart intent", lambda d: d["mart_order_intent"]),
    "services": ("Services of interest", lambda d: d[list(SERVICES)].sum(axis=1)),
    "fresh": ("Wants fresh produce", lambda d: d["int_fresh_produce"]),
    "pet": ("Wants pet supplies", lambda d: d["int_pet_supplies"]),
    "pharmacyInt": ("Wants pharmacy", lambda d: d["int_pharmacy"]),
}
FEATURE_SETS = {
    "churn": ["age", "income", "family", "student", "recency", "orders", "aov", "pro", "proFormer", "usedMart", "keeta", "otherApps",
              "share", "satisfaction", "speed", "issues", "discountImp", "voucherOrders"],
    "mart": ["age", "income", "family", "alone", "orders", "pro", "usedMart", "groceryFreq", "grocerySpend", "fresh", "pet", "pharmacyInt",
             "satisfaction", "discountImp"],
    "uplift": ["discountImp", "voucherOrders", "pro", "orders", "recency", "income", "age", "keeta", "satisfaction", "student"],
    "spend": ["income", "family", "alone", "age", "orders", "aov", "spend", "pro", "satisfaction", "services", "grocerySpend", "martIntent",
              "groceryShift", "discountImp"],
}
TARGETS = {"churn": ("churn_risk", "Churn risk (G1 = 4–5)"), "mart": ("mart_interested", "talabat mart interest (G4 = 4–5)")}


def load_data(source=None) -> pd.DataFrame:
    df = pd.read_csv(source if source is not None else DATA_PATH)
    missing = [c for c in REQUIRED if c not in df.columns]
    if missing:
        raise ValueError("Missing columns: " + ", ".join(missing))
    return df


def features(df: pd.DataFrame, name: str) -> pd.DataFrame:
    cols = {FEATURES[k][0]: FEATURES[k][1](df) for k in FEATURE_SETS[name]}
    return pd.DataFrame(cols).fillna(0).astype(float)


# ---------- Clustering ----------
def rfm_ranks(df: pd.DataFrame) -> pd.DataFrame:
    """Recency, frequency, monetary as percentile ranks: 0 = worst, 1 = best (the usual RFM scoring scale)."""
    return pd.DataFrame({
        "R": (-df["recency_days"]).rank(pct=True),
        "F": df["orders_per_month"].rank(pct=True),
        "M": df["talabat_monthly_spend_aed"].rank(pct=True),
    })


SEG_NAMES = {2: ["Most probable", "Least probable"], 3: ["Most probable", "Medium probable", "Least probable"],
             4: ["Most probable", "Medium-high", "Medium-low", "Least probable"],
             5: ["Most probable", "High-medium", "Medium", "Low-medium", "Least probable"]}


def run_kmeans(df: pd.DataFrame, k: int = 3, seed: int = 11):
    Z = rfm_ranks(df).values
    elbow = pd.DataFrame({"k": range(1, 9), "inertia per customer": [KMeans(n_clusters=i, n_init=4, random_state=seed).fit(Z).inertia_ / len(Z) for i in range(1, 9)]})
    km = KMeans(n_clusters=k, n_init=10, random_state=seed).fit(Z)
    sil = silhouette_score(Z, km.labels_, sample_size=min(1000, len(Z)), random_state=seed)
    d = df.assign(cluster=km.labels_)
    prof = d.groupby("cluster").agg(customers=("respondent_id", "count"), days_since_order=("recency_days", "mean"),
                                    orders_per_month=("orders_per_month", "mean"), monthly_spend_aed=("talabat_monthly_spend_aed", "mean"),
                                    churn_risk=("churn_risk", "mean"), mart_interest=("mart_interested", "mean"),
                                    willing_spend_aed=("willing_monthly_spend_aed", "mean"))
    prof = prof.sort_values("monthly_spend_aed", ascending=False)
    names = dict(zip(prof.index, SEG_NAMES[k]))
    prof.index = [names[c] for c in prof.index]
    prof.index.name = "segment"
    segment = pd.Series([names[c] for c in km.labels_], index=df.index, name="segment")
    return segment, prof, elbow, float(sil)


# ---------- Classification ----------
def _classifiers(seed=42):
    xgb = (XGBClassifier(n_estimators=150, max_depth=3, learning_rate=0.1, subsample=0.8, colsample_bytree=0.8, reg_lambda=1.0,
                         eval_metric="logloss", random_state=seed) if HAS_XGB else XGBClassifier(max_depth=3, learning_rate=0.1, random_state=seed))
    return {
        "Logistic regression": make_pipeline(StandardScaler(), LogisticRegression(max_iter=1000)),
        "Decision tree (depth 3)": DecisionTreeClassifier(max_depth=3, min_samples_leaf=20, random_state=seed),
        "Gradient boosting": GradientBoostingClassifier(n_estimators=150, max_depth=3, learning_rate=0.1, random_state=seed),
        ("XGBoost" if HAS_XGB else "XGBoost (fallback: HistGradientBoosting)"): xgb,
    }


def run_classifiers(df: pd.DataFrame, task: str = "churn", threshold: float = 0.5, seed: int = 42):
    X, y = features(df, task), df[TARGETS[task][0]].astype(int)
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.25, random_state=seed, stratify=y)
    rows, rocs, models = [], {}, {}
    for name, model in _classifiers(seed).items():
        model.fit(Xtr, ytr)
        p = model.predict_proba(Xte)[:, 1]
        pred = (p >= threshold).astype(int)
        rows.append({"model": name, "accuracy": accuracy_score(yte, pred), "precision": precision_score(yte, pred, zero_division=0),
                     "recall": recall_score(yte, pred), "f1": f1_score(yte, pred), "roc_auc": roc_auc_score(yte, p)})
        fpr, tpr, _ = roc_curve(yte, p)
        rocs[name] = pd.DataFrame({"false positive rate": fpr, "true positive rate": tpr})
        models[name] = model
    metrics = pd.DataFrame(rows).set_index("model")
    best = metrics["roc_auc"].idxmax()
    booster = models[[m for m in models if m.startswith("XGBoost")][0]]
    imp = getattr(booster, "feature_importances_", None)
    if imp is None:
        imp = models["Gradient boosting"].feature_importances_
    importance = pd.Series(imp, index=X.columns).sort_values(ascending=False)
    importance = importance / importance.sum()
    proba_all = pd.Series(booster.predict_proba(X)[:, 1], index=df.index, name="probability")
    return metrics, rocs, importance, best, proba_all


# ---------- Association rules (Apriori) ----------
def apriori(df: pd.DataFrame, min_support: float = 0.05, max_len: int = 3):
    T = df[list(SERVICES)].astype(bool).values
    n, items = len(T), list(range(T.shape[1]))
    support = {}

    def sup(s):
        return float(T[:, list(s)].all(axis=1).mean())

    level = []
    for i in items:
        s = sup((i,))
        support[(i,)] = s
        if s >= min_support:
            level.append((i,))
    frequent = list(level)
    k = 2
    while level and k <= max_len:
        prev = set(level)
        cands = set()
        for a, b in combinations(level, 2):
            if a[:-1] == b[:-1]:
                c = tuple(sorted(set(a) | set(b)))
                if len(c) == k and all(tuple(x) in prev for x in combinations(c, k - 1)):
                    cands.add(c)
        level = []
        for c in sorted(cands):
            s = sup(c)
            support[c] = s
            if s >= min_support:
                level.append(c)
        frequent += level
        k += 1
    return support, frequent, n


def rules(support: dict, frequent: list, min_conf: float = 0.3, min_lift: float = 1.2) -> pd.DataFrame:
    names = list(SERVICES.values())
    out = []
    for s in frequent:
        if len(s) < 2:
            continue
        for cons in s:
            ante = tuple(x for x in s if x != cons)
            conf = support[s] / support[ante]
            lift = conf / support[(cons,)]
            if conf >= min_conf and lift >= min_lift:
                out.append({"if interested in": " + ".join(names[i] for i in ante), "then also": names[cons], "type": f"{len(ante)} → 1",
                            "support": support[s], "confidence": conf, "lift": lift})
    cols = ["if interested in", "then also", "type", "support", "confidence", "lift"]
    return pd.DataFrame(out, columns=cols).sort_values(["lift", "confidence"], ascending=False).reset_index(drop=True)


# ---------- Regression ----------
def run_regression(df: pd.DataFrame, seed: int = 44):
    X, y = features(df, "spend"), df["willing_monthly_spend_aed"].astype(float)
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.25, random_state=seed)
    models = {
        "Linear regression": make_pipeline(StandardScaler(), LinearRegression()),
        "Gradient boosting": GradientBoostingRegressor(n_estimators=200, max_depth=3, learning_rate=0.1, random_state=seed),
        ("XGBoost" if HAS_XGB else "XGBoost (fallback: HistGradientBoosting)"):
            (XGBRegressor(n_estimators=200, max_depth=3, learning_rate=0.1, subsample=0.8, colsample_bytree=0.8, random_state=seed)
             if HAS_XGB else XGBRegressor(max_depth=3, learning_rate=0.1, random_state=seed)),
    }
    rows, preds = [], {}
    for name, m in models.items():
        m.fit(Xtr, ytr)
        p = m.predict(Xte)
        preds[name] = p
        rows.append({"model": name, "r2": r2_score(yte, p), "mae_aed": mean_absolute_error(yte, p), "rmse_aed": float(np.sqrt(mean_squared_error(yte, p)))})
    metrics = pd.DataFrame(rows).set_index("model")
    best = metrics["r2"].idxmax()
    pva = pd.DataFrame({"actual": yte.values, "predicted": preds[best]})
    lin = models["Linear regression"][-1]
    coefs = pd.Series(lin.coef_, index=X.columns).sort_values(key=np.abs, ascending=False)
    gb = models["Gradient boosting"]
    importance = pd.Series(gb.feature_importances_, index=X.columns).sort_values(ascending=False)
    return metrics, pva, coefs, importance, best, models[best], list(X.columns)


# ---------- A/B test and uplift ----------
def ab_test(df: pd.DataFrame) -> dict:
    a = df[df["scenario_group"] == "A_control"]
    b = df[df["scenario_group"] == "B_voucher"]
    p1, p2, n1, n2 = a["scenario_converted"].mean(), b["scenario_converted"].mean(), len(a), len(b)
    pp = (a["scenario_converted"].sum() + b["scenario_converted"].sum()) / (n1 + n2)
    z = (p2 - p1) / np.sqrt(pp * (1 - pp) * (1 / n1 + 1 / n2))
    se = np.sqrt(p1 * (1 - p1) / n1 + p2 * (1 - p2) / n2)
    t = stats.ttest_ind(b["scenario_order_intent"], a["scenario_order_intent"], equal_var=False)
    return {"control": p1, "voucher": p2, "n_control": n1, "n_voucher": n2, "diff": p2 - p1, "z": float(z),
            "p": float(2 * (1 - stats.norm.cdf(abs(z)))), "ci_low": p2 - p1 - 1.96 * se, "ci_high": p2 - p1 + 1.96 * se,
            "t": float(t.statistic), "t_p": float(t.pvalue)}


def run_uplift(df: pd.DataFrame, delta: float = 0.10, seed: int = 45):
    X = features(df, "uplift")
    y = df["scenario_converted"].astype(int)
    treated = (df["scenario_group"] == "B_voucher").values

    def booster(s):
        if HAS_XGB:
            return XGBClassifier(n_estimators=120, max_depth=3, learning_rate=0.08, reg_lambda=5.0, min_child_weight=5,
                                 subsample=0.8, colsample_bytree=0.8, eval_metric="logloss", random_state=s)
        return XGBClassifier(max_depth=3, learning_rate=0.08, random_state=s)

    mT, mC = booster(seed).fit(X[treated], y[treated]), booster(seed + 1).fit(X[~treated], y[~treated])
    pT, pC = mT.predict_proba(X)[:, 1], mC.predict_proba(X)[:, 1]
    up = pT - pC
    group = np.where(up >= delta, "Persuadable", np.where(up <= -delta, "Do-not-disturb", np.where(pC >= 0.4, "Sure thing", "Lost cause")))
    out = pd.DataFrame({"respondent_id": df["respondent_id"], "p_order_with_voucher": pT, "p_order_without": pC, "uplift": up, "group": group})
    return out

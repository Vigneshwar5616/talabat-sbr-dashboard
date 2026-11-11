# talabat Customer Intelligence Simulator (SBR group project)

A live dashboard for our SBR on **talabat** and its three problems:

1. **Retention:** low-value customers are leaving for discount-led rivals.
2. **Discounts:** vouchers are squeezing margins.
3. **Grocery:** food-only customers rarely buy groceries.

It also has a **P&L and competitor** view.

> Survey data is **synthetic**, generated from our questionnaire. This project is not affiliated with talabat. In the P&L tab, published figures are marked *Reported* and our estimates *Modelled*.

## What's inside

| Page | What it does |
|---|---|
| **Live simulator** | The full interactive dashboard. New survey responses stream in. Scenario shocks (Keeta discount week, delivery issues spike, Ramadan) change the incoming data, and every model retrains live in the browser. |
| **Python ML lab** | The same algorithm families rebuilt in scikit-learn and XGBoost on the survey CSV. You can upload real responses with the same columns, and download the data. |

Algorithms, by family:

- **Clustering:** K-means on RFM (recency, frequency, monetary), with an elbow chart and silhouette score.
- **Classification:** logistic regression, decision tree, gradient boosting and XGBoost, for churn risk and for talabat mart interest.
- **Association:** Apriori rules on 10 services, with support, confidence and lift.
- **Regression:** linear regression, gradient boosting and XGBoost, predicting willingness to spend.
- **Testing:** A/B z-test and t-test, and two-model uplift.

## Project structure

All files sit in the top folder, so the repo can be uploaded through GitHub's web page.

```
streamlit_app.py          entry point (page navigation)
simulator.py              page 1: embeds dashboard.html
python_lab.py             page 2: scikit-learn / XGBoost versions of the models
ml_lab.py                 Python model code used by the lab page
dashboard.html            built single-file dashboard (HTML + CSS + JS)
dashboard_template.html, styles.css, generator.js, ml.js, features.js, charts.js, app.js
                          dashboard source files
build_dashboard.py        rebuilds dashboard.html from the source files
talabat_survey_synthetic_1500.csv   seed dataset (54 columns)
requirements.txt          Python packages
```

## Run on your computer

```bash
pip install -r requirements.txt
streamlit run streamlit_app.py
```

## Deploy on Streamlit Community Cloud

1. Push this repository to GitHub.
2. Go to https://share.streamlit.io and sign in with GitHub.
3. Click **Create app**, then **Deploy a public app from GitHub**.
4. Choose this repository and the `main` branch, and set the main file path to `streamlit_app.py`.
5. Click **Deploy**. The first build takes about 2–4 minutes.

## Edit the dashboard

Change the source files, then run `python build_dashboard.py` to regenerate `dashboard.html`, and push. Streamlit redeploys automatically.

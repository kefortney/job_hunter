# Job Board

A static, interactive board of job listings near Burlington, VT. You can search, filter and sort the roles, see them on a map, and open each one for details. It's plain HTML, CSS and JavaScript with no build step, so it runs on GitHub Pages as-is. The map uses [Leaflet](https://leafletjs.com/) and OpenStreetMap tiles, loaded from a CDN.

## Features

- **Table** of roles, sorted by fit score by default. Click any column header to sort by it, and click again to reverse. Pay sorts by estimated hourly rate, so hourly and salaried roles sort together. Blank values always sort last.
- **Details**: click a row to see the description, requirements, how to apply, links, address, and notes.
- **Filters**:
  - search
  - open only
  - minimum fit score
  - Connector compatibility
  - org type
  - employment type
  - work mode
  - maximum distance from Burlington City Hall
  - minimum hourly pay (roles with no posted pay are always shown)
  - tags (if you select several tags, a role must have all of them)
- **Map**: one marker per location, colored by the best fit score there. A larger marker means several roles share that location. Click a marker to list the roles there and jump to one. The map shows only roles that match the current filters.
- **Location caveats**: approximate geocodes have a dashed outline on the map. Roles with an approximate location or an address that isn't fully verified get a ⚠ in the table and an explanation in their details.
- **Deadlines** show how many days are left. Deadlines within 7 days are highlighted and past deadlines are struck through.
- **Shareable links**: `index.html#J002` opens that role directly.
- Light and dark mode follow your system setting.

## Data: `data/jobs.csv`

All listings come from [`data/jobs.csv`](data/jobs.csv). To update the board, replace that file and keep the same column names. Columns can be in any order.

| Column | Used for |
|---|---|
| `id` | Unique row ID (e.g. `J001`), used in links |
| `title`, `organization` | Role column |
| `org_type` | Org type filter |
| `employment_type` | Type column. The filter groups values into Full-time / Part-time / Contract / Temporary / Unconfirmed |
| `hours_per_week` | Details |
| `work_mode` | Work mode column. The filter groups values into On-site / Hybrid / Remote / Unconfirmed |
| `connector_compatible` | Filter uses the first word (Yes / Maybe / Unlikely / No) |
| `pay_display`, `pay_source`, `pay_unit` | Pay column and details |
| `est_hourly_min/max`, `est_annual_min/max` | Pay sorting, the min-pay filter, and the "≈" equivalent pay |
| `posted_date`, `deadline` | ISO dates (`YYYY-MM-DD`) |
| `status`, `is_open` | Status column. `is_open` = `Yes` drives the Open/Not open label and filter |
| `fit_score` (1–5), `fit_label`, `fit_rationale` | Fit column, filter, map color, details |
| `tags` | Semicolon-separated, e.g. `Grants;Policy` |
| `description`, `requirements`, `how_to_apply` | Details |
| `apply_url`, `source_url` | Links (`http(s):` or `mailto:` only) |
| `full_address`, `county`, ... | Details |
| `latitude`, `longitude` | Map position |
| `geocode_method` | A value starting with `Approximate` gets a dashed outline and a warning |
| `address_verified` | Any value not starting with `Yes` gets a warning |
| `miles_from_burlington_city_hall` | Miles column and distance filter (straight line) |
| `notes`, `last_checked` | Details. The latest `last_checked` date is shown as the status snapshot date |

### Data caveats

- Coordinates come from the US Census geocoder.
- Some rows are approximate (see `geocode_method`):
  - The State Police and Emergency Management rows use the Waterbury state office complex.
  - The Vermont Youth Conservation Corps row uses Richmond town center.
- The Winooski Housing Authority address hasn't been checked against the posting (`address_verified`). Confirm it with the employer.
- Home-based and remote roles are mapped to the employer's office.
- Status values are a snapshot as of `last_checked`. Postings close fast.

## Running locally

Browsers block `fetch()` on `file://` URLs, so serve the folder instead of opening `index.html` directly:

```sh
python -m http.server 8000
```

Then open <http://localhost:8000>.

## Deploying to GitHub Pages

1. Push this folder to a GitHub repository.
2. Go to **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, select `main` and `/ (root)`, and save.
4. The site will be live at `https://<username>.github.io/<repo-name>/` within a minute or two.

The empty `.nojekyll` file tells GitHub Pages to serve the files as-is.

## Project structure

```
.
├── index.html     # Page layout and filter controls
├── style.css      # Styles, including the fit-score color ramp
├── app.js         # CSV loading, filtering, sorting, table, and map
├── data/
│   └── jobs.csv   # Listings data
├── .nojekyll
└── README.md
```

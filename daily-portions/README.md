# Daily Portions

A tiny, no-build PWA for iPhone. All portion counts and goals are saved to this device's browser storage, not the hosting service.

## Run on your Mac

Open this folder in VS Code. For a quick local test, open `index.html` in Safari or use VS Code's Live Server extension. To test the offline service worker on the Mac, serve this folder on `localhost`, for example with `python3 -m http.server 8000` and open `http://localhost:8000`.

## Publish (free)

Push the folder to a GitHub repository, then import it on Vercel as a static project. The project requires no build command and its output directory is the root (`.`). Deploy it, open the HTTPS URL in iPhone Safari, then tap Share → Add to Home Screen (enable 'Open as Web App' if the option appears).

## Testing the date reset

Expand **Developer tests (temporary)**, add test portions using **Simulate tomorrow**, refresh the page and confirm they are retained; tap **Return to today** and confirm your real today's portions are still there. A real next calendar day begins with zero values and preserves goals; the app checks upon resume and every minute while open.

## Notes

- Daily logs only: previous real days are not retained after you first open the app on a new day.
- Goal editing is in quarter-portion increments; consumed amounts are never negative.
- Removing the app or clearing website data can delete saved portions. No cloud sync or backup in this version.
- Safari and a Home Screen web app can have separate storage. Use the installed Home Screen app consistently for logging.
- Developer test controls should be removed before the final production version if desired.

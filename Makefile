TF_DIR=terraform/main
TF_ENV?=prod

.PHONY: backend-install backend-dev backend-test terraform-init terraform-plan terraform-apply mobile-build-ipa mobile-publish-ipa mobile-release

backend-install: ## install backend deps into .venv
	cd backend && python3.12 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt

backend-dev: ## run backend locally
	cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000

backend-test: ## run backend tests
	cd backend && .venv/bin/pytest -q

terraform-init:
	terraform -chdir=$(TF_DIR) init -backend-config=../workspaces/$(TF_ENV)/backend.conf

terraform-plan:
	terraform -chdir=$(TF_DIR) plan -var-file=../workspaces/$(TF_ENV)/terraform.tfvars

terraform-apply:
	terraform -chdir=$(TF_DIR) apply -auto-approve -var-file=../workspaces/$(TF_ENV)/terraform.tfvars

seed-exercises: ## seed system exercise catalog (uses ADC; set FIRESTORE_DATABASE)
	cd backend && .venv/bin/python scripts/seed_exercises.py

import-exercise-db: ## import Free Exercise DB into Firestore exercises collection (uses ADC; set FIRESTORE_DATABASE)
	cd backend && .venv/bin/python scripts/import_free_exercise_db.py

mobile-install: ## install mobile deps via root workspace
	npm install

mobile-start: ## expo dev server
	cd mobile && npx expo start

mobile-sim: ## build + launch on iOS simulator (Release if needed via --variant)
	cd mobile && npx expo run:ios

mobile-run-phone: ## build + install Release on connected iPhone (DEVICE_NAME=<substr> or DEVICE=<udid>)
	@DEVICE_UDID=$${DEVICE:-$$(xcrun xctrace list devices 2>&1 | grep -i "$${DEVICE_NAME:-iPhone}" | grep -v Simulator | head -1 | sed -E 's/.*\(([0-9A-F-]{20,})\).*/\1/')}; \
	if [ -z "$$DEVICE_UDID" ]; then echo "No matching connected iPhone found"; exit 1; fi; \
	cd mobile && npx expo run:ios --device "$$DEVICE_UDID" --configuration Release

mobile-update: ## OTA via EAS Update (JS-only changes)
	cd mobile && npx eas update --branch main --auto

mobile-typecheck: ## tsc --noEmit
	cd mobile && npx tsc --noEmit

mobile-build-ipa: ## Build an unsigned .ipa locally for AltStore sideload (no Apple Developer Program needed)
	@cd mobile && npx expo prebuild --platform ios --no-install 2>/dev/null || true
	@# macOS 15 + Xcode 16 sandbox blocks Node bundler in xcode build phase; flip flag.
	@sed -i '' 's/ENABLE_USER_SCRIPT_SANDBOXING = YES/ENABLE_USER_SCRIPT_SANDBOXING = NO/g' mobile/ios/FitnessTracker.xcodeproj/project.pbxproj
	@cd mobile/ios && xcodebuild \
		-workspace FitnessTracker.xcworkspace \
		-scheme FitnessTracker \
		-configuration Release \
		-archivePath /tmp/FitnessTracker.xcarchive \
		-destination 'generic/platform=iOS' \
		archive \
		CODE_SIGNING_ALLOWED=NO
	@mkdir -p /tmp/FitnessTracker-ipa/Payload
	@cp -R /tmp/FitnessTracker.xcarchive/Products/Applications/FitnessTracker.app /tmp/FitnessTracker-ipa/Payload/
	@cd /tmp/FitnessTracker-ipa && zip -qr ~/Downloads/FitnessTracker.ipa Payload && rm -rf /tmp/FitnessTracker-ipa /tmp/FitnessTracker.xcarchive
	@mkdir -p "$$HOME/Library/Mobile Documents/com~apple~CloudDocs/Share"
	@cp ~/Downloads/FitnessTracker.ipa "$$HOME/Library/Mobile Documents/com~apple~CloudDocs/Share/FitnessTracker.ipa"
	@echo "Built: ~/Downloads/FitnessTracker.ipa"
	@echo "Also copied to: ~/Library/Mobile Documents/com~apple~CloudDocs/Share/FitnessTracker.ipa"
	@echo "Drag this onto AltServer's menubar icon to install via AltStore."

mobile-publish-ipa: ## Publish the most-recent built .ipa to a GitHub Release and update the shared AltStore source so both phones get an "Update available" notification. Pass VERSION=x.y.z (required).
	@if [ -z "$$VERSION" ]; then echo "Usage: make mobile-publish-ipa VERSION=1.2.3"; exit 1; fi
	@IPA="$$HOME/Library/Mobile Documents/com~apple~CloudDocs/Share/FitnessTracker.ipa"; \
	BUNDLE_ID="org.blueelephants.fitnesstracker"; \
	REPO="dhishan/fitness-coach"; \
	SOURCE="../family-expense-tracker/frontend/public/altstore.json"; \
	if [ ! -f "$$IPA" ]; then echo "No .ipa at $$IPA. Run 'make mobile-build-ipa' first."; exit 1; fi; \
	echo "Creating GH Release mobile-v$$VERSION with $$IPA..."; \
	gh release create "mobile-v$$VERSION" "$$IPA" --repo "$$REPO" \
	  --title "Mobile v$$VERSION" \
	  --notes "AltStore-source release. JS-only changes ship via EAS Update; this release is only needed when native deps change." || \
	gh release upload "mobile-v$$VERSION" "$$IPA" --repo "$$REPO" --clobber; \
	IPA_SIZE=$$(stat -f %z "$$IPA"); \
	IPA_DATE=$$(date -u +"%Y-%m-%dT%H:%M:%SZ"); \
	echo "Updating $$SOURCE to point at mobile-v$$VERSION..."; \
	python3 -c "import json; \
	p='$$SOURCE'; \
	d=json.load(open(p)); \
	bid='$$BUNDLE_ID'; \
	app=next(a for a in d['apps'] if a['bundleIdentifier']==bid); \
	new_v={'version':'$$VERSION','buildVersion':'1','date':'$$IPA_DATE','localizedDescription':'New version $$VERSION','downloadURL':'https://github.com/$$REPO/releases/download/mobile-v$$VERSION/FitnessTracker.ipa','size':$$IPA_SIZE,'minOSVersion':'16.0'}; \
	app['versions']=[new_v]+[v for v in app['versions'] if v['version']!='$$VERSION']; \
	json.dump(d, open(p,'w'), indent=2); print('updated', p)"
	@cd ../family-expense-tracker && git add frontend/public/altstore.json && git commit -m "release: fitness-tracker v$(VERSION) (AltStore source)" && git push
	@echo "Pushed. Both phones will see the update in AltStore after Firebase Hosting deploys (~1 min)."

e2e-mobile: ## run all Maestro flows against iOS sim (requires: brew install maestro, JWT in ~/.fitness-test-jwt)
	export MAESTRO_LOGIN_TOKEN=$$(cat ~/.fitness-test-jwt 2>/dev/null || echo "missing-token"); \
	maestro test .maestro/

e2e-mobile-flow: ## run a single Maestro flow: make e2e-mobile-flow FLOW=02-add-food-search.yaml
	maestro test .maestro/$(FLOW)

mobile-release: ## Bump version, tag, push — triggers GH Actions to build + publish IPA. BUMP=patch|minor|major (default patch).
	@BUMP=$${BUMP:-patch}; \
	LAST=$$(git tag --list 'mobile-v*' | sort -V | tail -1 | sed 's/^mobile-v//'); \
	if [ -z "$$LAST" ]; then echo "No existing mobile-v* tag; starting at 1.0.0"; NEW=1.0.0; \
	else \
	  MAJOR=$$(echo $$LAST | cut -d. -f1); MINOR=$$(echo $$LAST | cut -d. -f2); PATCH=$$(echo $$LAST | cut -d. -f3); \
	  case "$$BUMP" in \
	    major) NEW=$$((MAJOR+1)).0.0 ;; \
	    minor) NEW=$$MAJOR.$$((MINOR+1)).0 ;; \
	    patch|*) NEW=$$MAJOR.$$MINOR.$$((PATCH+1)) ;; \
	  esac; \
	fi; \
	echo "Last: $${LAST:-(none)}  ->  New: $$NEW ($$BUMP)"; \
	if ! git diff-index --quiet HEAD --; then echo "Uncommitted changes — commit first."; exit 1; fi; \
	git tag "mobile-v$$NEW" && git push --tags && \
	  echo "Tagged mobile-v$$NEW. Watch: gh run watch --repo dhishan/fitness-coach --workflow release-ipa.yml"

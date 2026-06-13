TF_DIR=terraform/main
TF_ENV?=prod

.PHONY: backend-install backend-dev backend-test terraform-init terraform-plan terraform-apply

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

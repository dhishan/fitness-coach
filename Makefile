TF_DIR=terraform/main
TF_ENV?=prod

.PHONY: backend-install backend-dev backend-test terraform-init terraform-plan terraform-apply

backend-install: ## install backend deps into .venv
	cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt

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

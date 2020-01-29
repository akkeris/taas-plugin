# Akkeris Taas CLI Plugin

Manage TaaS tests with the Akkeris CLI

## Installation

`aka plugins:install taas`

Set the environment variable `DIAGNOSTICS_API_URL` to the hostname of the TaaS API. (You may want to add this to your `.bashrc`, `.bash_profile`, or `.zshrc`)

## Commands

The following commands are available: 

| Command | Description | Example |
|---------|-------------|---------|
| taas:images | List all images used by taas | `aka taas:images` |
| taas:tests | List all configured tests | `aka taas:tests` |
| taas:tests:register | Register a new test | `aka taas:tests:register` |
| taas:tests:info ID | Describe a specific test | `aka taas:tests:info ui-tests-taas` |
| taas:tests:update ID -p property -v value | Update test configuration | `aka taas:tests:update ui-tests-taas -p timeout -v 20` |
| taas:tests:destroy ID | Delete a test | `aka taas:tests:destroy ui-tests-taas` |
| taas:tests:trigger ID | Trigger a run for a test | `aka taas:tests:trigger ui-tests-taas` |
| taas:tests:runs ID | View all runs for a test | `aka taas:tests:runs ui-tests-taas` |
| taas:config ID | List environment variables for a test | `aka taas:config ui-tests-taas` |
| taas:config:set ID KVPAIR | Set an environment variable on a test | `aka taas:config:set ui-tests-taas FOO="BAR"` |
| taas:config:unset ID VAR | Unset an environment variable on a test | `aka taas:config:unset ui-tests-taas FOO` |
| taas:&#8203;secret:create ID -p plan_name | Add a secret to a test | `aka taas:secret:create ui-tests-taas -p plan` |
| taas:&#8203;secret:remove ID -p plan_name | Remove a secret from a test | `aka taas:secret:remove ui-tests-taas -p plan` |
| taas:hooks:create ID | Add testing hooks to a test's target app | `aka taas:hooks:create ui-tests-taas` |
| taas:runs:info ID | Get info for a run | `aka taas:runs:info fda602a1-f096-4e2c-4b21-ef88ae05bbc7` |
| taas:runs:output ID | Get logs for a run. If ID is a test name, gets latest | `aka taas:runs:output fda602a1-f096-4e2c-4b21-ef88ae05bbc7` |
| taas:runs:rerun ID | Reruns a run | `aka taas:runs:rerun fda602a1-f096-4e2c-4b21-ef88ae05bbc7` |
| taas:runs:artifacts ID | Get link to view artifacts for a run | `aka taas:artifacts fda602a1-f096-4e2c-4b21-ef88ae05bbc7` |
| taas:logs ID | Get logs for a run. If ID is a test name, gets latest | `aka taas:logs fda602a1-f096-4e2c-4b21-ef88ae05bbc7` |

For more information, run any command with the `--help` option

To see a list of commands on the CLI, use `aka --help`
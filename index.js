const inquirer = require('inquirer');
const https = require('https');
const fuzzy = require('fuzzy');
inquirer.registerPrompt('autocomplete', require('inquirer-autocomplete-prompt'));

// This will be removed when TaaS is made a first-class citizen
const DIAGNOSTICS_API_URL = process.env.DIAGNOSTICS_API_URL || 'https://alamo-self-diagnostics.octanner.io';

const jsonType = { 'Content-Type': 'application/json' };
const plainType = { 'Content-Type': 'text/plain' };

function parseError(error) {
  if (error.body) {
    try {
      const json = JSON.parse(error.body.toString());
      if (json.response) {
        return json.response;
      }
      return json;
    } catch (err) {
      return error.body.toString();
    }
  } else {
    return error.toString();
  }
}

async function createcronjob(appkit, args) {
  try {
    const diag = await appkit.http.get(`${DIAGNOSTICS_API_URL}/v1/diagnostic/${args.ID}`, plainType);
    const cron = {
      job: diag.job,
      jobspace: diag.jobspace,
      cs: args.s,
      command: args.c,
    };
    const resp = await appkit.api.post(JSON.stringify(cron), `${DIAGNOSTICS_API_URL}/v1/cronjob`);
    appkit.terminal.vtable(resp);
  } catch (err) {
    appkit.terminal.error(parseError(err));
  }
}

async function destroycronjob(appkit, args) {
  try {
    const resp = await appkit.api.delete(`${DIAGNOSTICS_API_URL}/v1/cronjob/${args.ID}`);
    appkit.terminal.vtable(resp);
  } catch (err) {
    appkit.terminal.error(parseError(err));
  }
}


async function getcronjobs(appkit) {
  try {
    const results = await appkit.api.get(`${DIAGNOSTICS_API_URL}/v1/cronjobs`);
    if (!results || results.length < 1) {
      appkit.terminal.error(appkit.terminal.markdown('No cronjobs found'));
      return;
    }
    appkit.terminal.table(results.map((cronjob) => {
      const entry = {
        id: cronjob.id,
        job: `${cronjob.job}-${cronjob.jobspace}`,
        cronspec: cronjob.cs,
        command: cronjob.command,
        prev: cronjob.prev,
        next: cronjob.next,
      };
      return entry;
    }));
  } catch (err) {
    appkit.terminal.error(parseError(err));
  }
}


async function getcronjobruns(appkit, args) {
  try {
    if (args.f === 'borked' || args.f === 'fail' || args.f === 'pizzled') {
      args.f = 'failed'; // eslint-disable-line no-param-reassign
    }
    if (args.f === 'pass' || args.f === 'passed') {
      args.f = 'success'; // eslint-disable-line no-param-reassign
    }
    let results;
    if (!args.n && !args.f) {
      results = await appkit.api.get(`${DIAGNOSTICS_API_URL}/v1/cronjob/${args.ID}/runs`);
    }
    if (args.n && !args.f) {
      results = await appkit.api.get(`${DIAGNOSTICS_API_URL}/v1/cronjob/${args.ID}/runs?runs=${args.n}`);
    }
    if (!args.n && args.f) {
      results = await appkit.api.get(`${DIAGNOSTICS_API_URL}/v1/cronjob/${args.ID}/runs?filter=${args.f}`);
    }
    if (args.n && args.f) {
      results = await appkit.api.get(`${DIAGNOSTICS_API_URL}/v1/cronjob/${args.ID}/runs?runs=${args.n}&filter=${args.f}`);
    }
    if (!results || results.length < 1) {
      appkit.terminal.error(appkit.terminal.markdown('No cronjob runs found'));
      return;
    }
    appkit.terminal.table(results.map((cronjobrun) => {
      const entry = {
        start: cronjobrun.starttime,
        end: cronjobrun.endtime,
        result: cronjobrun.overallstatus,
        links: (cronjobrun.overallstatus === 'timedout'||cronjobrun.overallstatus==='failed') ? `Logs: ${DIAGNOSTICS_API_URL}/v1/diagnostic/logs/${cronjobrun.runid}\nArtifacts: ${DIAGNOSTICS_API_URL}/v1/artifacts/${cronjobrun.runid}/` : '',
      };
      return entry;
    }));
  } catch (err) {
    appkit.terminal.error(parseError(err));
  }
}

let streamRestarts = 0;
async function taillogs(appkit, args) { // eslint-disable-line
  const id = args.ID;
  if (streamRestarts === 0) {
    console.log(appkit.terminal.markdown('^^waiting for logs... ^^'));
  }
  try {
    if (streamRestarts > 20) {
      return process.exit(1);
    }
    const req = https.request(`${DIAGNOSTICS_API_URL}/v1/diagnostic/${args.ID}/taillogs`, (res) => {
      res.pipe(process.stdout);
      res.on('end', () => {
        streamRestarts++; // eslint-disable-line
        args.ID = id; // eslint-disable-line
        console.log(appkit.terminal.markdown('^^waiting for logs... ^^'));
        taillogs(appkit, args);
      });
    });
    req.on('error', (e) => {
      if (e.code === 'ECONNRESET') {
        streamRestarts++; // eslint-disable-line
        args.ID = id; // eslint-disable-line
        console.log(appkit.terminal.markdown('^^waiting for logs... ^^'));
        taillogs(appkit, args);
      }
    });
    req.setNoDelay(true);
    req.end();
  } catch (err) {
    appkit.terminal.error(parseError(err));
  }
}

async function audits(appkit, args) {
  try {
    const results = await appkit.api.get(`${DIAGNOSTICS_API_URL}/v1/diagnostic/${args.ID}/audits`);
    if (!results || results.length < 1) {
      appkit.terminal.error(appkit.terminal.markdown(`No audits found for ***${args.ID}***`));
      return;
    }
    appkit.terminal.table(results.map((audit) => {
      const entry = {
        date: audit.created_at,
        user: audit.audituser,
        type: audit.audittype,
        key: audit.auditkey,
      };
      if (entry.type !== 'properties' && entry.type !== 'register' && entry.type !== 'destroy') {
        entry.newvalue = audit.newvalue;
      } else {
        const newvalue = JSON.parse(audit.newvalue);
        entry.newval = `${audit.audittype !== 'properties' ? `APP: ${newvalue.app}-${newvalue.space}\nJOB: ${newvalue.job}-${newvalue.jobspace}\n` : ''}`;
        entry.newval += `IMAGE: ${newvalue.image}\n`;
        entry.newval += `PIPELINE: ${newvalue.pipelinename}\n`;
        entry.newval += `TRANSITION FROM: ${newvalue.transitionfrom}\n`;
        entry.newval += `TRANSITION TO: ${newvalue.transitionto}\n`;
        entry.newval += `TIMEOUT: ${newvalue.timeout}\n`;
        entry.newval += `START DELAY: ${newvalue.startdelay}\n`;
        entry.newval += `SLACK CHANNEL: ${newvalue.slackchannel}\n`;
        entry.newval += `COMMAND: ${newvalue.command || 'Default command in image'}`;
      }
      return entry;
    }));
  } catch (err) {
    appkit.terminal.error(parseError(err));
  }
}

async function multiUnSet(appkit, args) {
  const prefix = args.p || args.prefix;
  const suffix = args.s || args.suffix;

  if (!prefix && !suffix) {
    console.log('Must specify either prefix or suffix');
    return;
  }

  if (prefix && suffix) {
    console.log('Can not specify both prefix and suffix');
    return;
  }

  try {
    const diagnostics = await appkit.http.get(`${DIAGNOSTICS_API_URL}/v1/diagnostics?simple=true`, jsonType);

    const matches = diagnostics.reduce((result, testitem) => {
      const testname = `${testitem.job}-${testitem.jobspace}`;
      if ((prefix && testname.startsWith(prefix)) || (suffix && testname.endsWith(suffix))) {
        result.push(testname);
      }
      return result;
    }, []);

    if (matches.length === 0) {
      console.log(`No matches for the ${prefix ? 'prefix' : 'suffix'} ${prefix || suffix}`);
      return;
    }

    console.log(`About to unset ${args.KEY} for:`);
    console.log(matches.join('\n'));

    const { confirm } = await inquirer.prompt({
      type: 'confirm',
      name: 'confirm',
      message: 'Continue?',
      default: false,
    });

    if (confirm) {
      console.log('Continuing ... ');

      matches.forEach(async (currentMatch) => {
        const resp = await appkit.api.delete(`${DIAGNOSTICS_API_URL}/v1/diagnostic/${currentMatch}/config/${args.KEY}`);
        appkit.terminal.vtable(resp);
      });
    }
  } catch (err) {
    appkit.terminal.error(parseError(err));
  }
}


async function multiSet(appkit, args) {
  const prefix = args.p || args.prefix;
  const suffix = args.s || args.suffix;

  if (!prefix && !suffix) {
    console.log('Must specify either prefix or suffix');
    return;
  }

  if (prefix && suffix) {
    console.log('Can not specify both prefix and suffix');
    return;
  }

  if (args.KVPAIR.split('=').length !== 2 || args.KVPAIR.split('=')[0] === '' || args.KVPAIR.split('=')[1] === '') {
    appkit.terminal.error('Invalid key/value pair.');
    return;
  }

  if (args.KVPAIR.match(/\s/g)) {
    appkit.terminal.error('Whitespace not allowed in key/value pair.');
    return;
  }

  const configvar = {
    varname: args.KVPAIR.split('=')[0],
    varvalue: args.KVPAIR.split('=')[1],
  };

  try {
    const diagnostics = await appkit.http.get(`${DIAGNOSTICS_API_URL}/v1/diagnostics?simple=true`, jsonType);

    const matches = diagnostics.reduce((result, testitem) => {
      const testname = `${testitem.job}-${testitem.jobspace}`;
      if ((prefix && testname.startsWith(prefix)) || (suffix && testname.endsWith(suffix))) {
        result.push(testname);
      }
      return result;
    }, []);

    if (matches.length === 0) {
      console.log(`No matches for the ${prefix ? 'prefix' : 'suffix'} ${prefix || suffix}`);
      return;
    }

    console.log(`About to set ${configvar.varname} to ${configvar.varvalue} for:`);
    console.log(matches.join('\n'));

    const { confirm } = await inquirer.prompt({
      type: 'confirm',
      name: 'confirm',
      message: 'Continue?',
      default: false,
    });

    if (confirm) {
      console.log('Continuing ... ');

      matches.forEach(async (currentMatch) => {
        const resp = await appkit.api.post(JSON.stringify(configvar), `${DIAGNOSTICS_API_URL}/v1/diagnostic/${currentMatch}/config`);
        appkit.terminal.vtable(resp);
      });
    }
  } catch (err) {
    appkit.terminal.error(parseError(err));
  }
}

function isUUID(str) {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(str);
}

async function setVar(appkit, args) {
  if (args.KVPAIR.split('=').length !== 2 || args.KVPAIR.split('=')[0] === '' || args.KVPAIR.split('=')[1] === '') {
    appkit.terminal.error('Invalid key/value pair.');
    return;
  }

  if (args.KVPAIR.match(/\s/g)) {
    appkit.terminal.error('Whitespace not allowed in key/value pair.');
    return;
  }

  const configvar = {
    varname: args.KVPAIR.split('=')[0],
    varvalue: args.KVPAIR.split('=')[1],
  };

  try {
    const resp = await appkit.api.post(JSON.stringify(configvar), `${DIAGNOSTICS_API_URL}/v1/diagnostic/${args.ID}/config`);
    appkit.terminal.vtable(resp);
  } catch (err) {
    appkit.terminal.error(parseError(err));
  }
}

async function unsetVar(appkit, args) {
  try {
    const resp = await appkit.api.delete(`${DIAGNOSTICS_API_URL}/v1/diagnostic/${args.ID}/config/${args.VAR}`);
    appkit.terminal.vtable(resp);
  } catch (err) {
    appkit.terminal.error(parseError(err));
  }
}

async function addSecret(appkit, args) {
  try {
    const plan = args.p || args.plan;
    const addonpart = plan.split(':')[0];
    const planpart = plan.split(':')[1];
    const { spec } = await appkit.api.get(`/addon-services/${addonpart}/plans/${planpart}`);
    const resp = await appkit.api.post(null, `${DIAGNOSTICS_API_URL}/v1/diagnostic/${args.ID}/bind/${spec}`);
    appkit.terminal.vtable(resp);
  } catch (err) {
    appkit.terminal.error(parseError(err));
  }
}

async function removeSecret(appkit, args) {
  try {
    const plan = args.p || args.plan;
    const addonpart = plan.split(':')[0];
    const planpart = plan.split(':')[1];
    const { spec } = await appkit.api.get(`/addon-services/${addonpart}/plans/${planpart}`);
    const resp = await appkit.http.delete(`${DIAGNOSTICS_API_URL}/v1/diagnostic/${args.ID}/bind/${spec}`, jsonType);
    appkit.terminal.vtable(resp);
  } catch (err) {
    appkit.terminal.error(parseError(err));
  }
}

async function trigger(appkit, args) {
  try {
    const {
      app, space, id, action, result,
    } = await appkit.http.get(`${DIAGNOSTICS_API_URL}/v1/diagnostic/${args.ID}`, plainType);
    const releases = await appkit.api.get(`/apps/${app}-${space}/releases`);
    const builds = await appkit.api.get(`/apps/${app}-${space}/builds`);
    const hook = {
      action,
      app: { id, name: app },
      space: { name: space },
      release: { result, id: releases.pop().id },
      build: { id: builds.length > 0 ? builds.pop().id : '' },
    };
    await appkit.api.post(JSON.stringify(hook), `${DIAGNOSTICS_API_URL}/v1/releasehook`);
    console.log(appkit.terminal.markdown('^^ run initiated ^^'));
  } catch (err) {
    appkit.terminal.error(parseError(err));
  }
}

async function reRun(appkit, args) {
  try {
    const { _source: source } = await appkit.http.get(`${DIAGNOSTICS_API_URL}/v1/diagnostics/runs/info/${args.ID}`, plainType);
    const query = `space=${source.space}&app=${source.app}&action=release&result=succeeded&buildid=${source.buildid}`;
    await appkit.http.get(`${DIAGNOSTICS_API_URL}/v1/diagnostic/rerun?${query}`, {});
    console.log(appkit.terminal.markdown('^^ rerun initiated ^^'));
  } catch (err) {
    appkit.terminal.error(parseError(err));
  }
}

async function runInfo(appkit, args) {
  try {
    const { _source: source } = await appkit.http.get(`${DIAGNOSTICS_API_URL}/v1/diagnostics/runs/info/${args.ID}`, plainType);
    if (typeof source.job === 'undefined' || source.job === '') {
      appkit.terminal.error(appkit.terminal.markdown('!!Invalid run ID!!'));
      return;
    }
    delete source.logs;
    appkit.terminal.vtable(source);
  } catch (err) {
    appkit.terminal.error(parseError(err));
  }
}

async function addHooks(appkit, args) {
  try {
    await appkit.http.post('', `${DIAGNOSTICS_API_URL}/v1/diagnostic/${args.ID}/hooks`, jsonType);
    console.log(appkit.terminal.markdown('^^ done ^^'));
    return; // If using updated TaaS backend then we're finished
  } catch (err) {
    if (err.code !== 404) {
      appkit.terminal.error(parseError(err));
      return;
    }
  }

  // Response from backend was 404. Using old TaaS backend. Manually create hooks.
  try {
    const jobItem = await appkit.http.get(`${DIAGNOSTICS_API_URL}/v1/diagnostic/${args.ID}`, jsonType);
    const app = `${jobItem.app}-${jobItem.space}`;

    const hooks = await appkit.api.get(`/apps/${app}/hooks`);
    const needsRelease = !hooks.some(hook => (
      hook.url.indexOf('/v1/releasehook') > -1
      && (
        hook.url.indexOf('taas') > -1 || hook.url.indexOf('alamo-self-diagnostics') > -1
      )
    ));
    const needsBuild = !hooks.some(hook => (
      hook.url.indexOf('/v1/buildhook') > -1
      && (
        hook.url.indexOf('taas') > -1 || hook.url.indexOf('alamo-self-diagnostics') > -1
      )
    ));
    let hook = {};
    if (needsRelease) {
      hook = {
        url: `${DIAGNOSTICS_API_URL}/v1/releasehook`,
        active: true,
        secret: 'merpderp',
        events: ['release'],
      };
      await appkit.api.post(JSON.stringify(hook), `/apps/${app}/hooks`);
      console.log(appkit.terminal.markdown('^^ release hook added ^^'));
    }
    if (needsBuild) {
      hook = {
        url: `${DIAGNOSTICS_API_URL}/v1/buildhook`,
        active: true,
        secret: 'merpderp',
        events: ['build'],
      };
      await appkit.api.post(JSON.stringify(hook), `/apps/${app}/hooks`);
      console.log(appkit.terminal.markdown('^^ build hook added ^^'));
    }
    console.log(appkit.terminal.markdown('^^ done ^^'));
  } catch (err) {
    appkit.terminal.error(err);
  }
}

async function newRegister(appkit, args) {
  const appNames = (await appkit.api.get('/apps')).map(i => i.name);
  if (appNames.length === 0) {
    appkit.terminal.error(appkit.terminal.markdown('###===### No apps were found. At least one app must exist in order to use this command.'));
  }

  // Validator Functions
  const isRequired = input => (input.length > 0 ? true : 'Required Field');

  const isInteger = input => (!Number.isInteger(input) ? 'Must be an Integer' : true);

  const hasHash = (input) => {
    if (input.length === 0) {
      return 'Required Field';
    } if (input.includes('#')) {
      return 'Please remove leading #';
    }
    return true;
  };

  const validEnv = (input) => {
    // This is an optional field
    if (!input || input.length === 0) {
      return true;
    }

    // Each pair should have exactly one '='
    // Key or value should not be an empty string
    const errors = input.split(' ').map((i) => {
      const pair = i.split('=');
      if (pair.length !== 2 || pair[0].length === 0 || pair[1].length === 0) {
        return i;
      }
      return null; // No error (will be filtered out)
    }).filter(a => !!a);

    // Display which key/value pairs had issues
    if (errors.length > 0) {
      return `${errors.length} errors found:\nYour Input: ${input}\nInvalid Entries: ${errors.join(', ')}`;
    }
    return true;
  };

  const searchApps = async input => fuzzy.filter((input || ''), appNames).map(e => e.original);

  const questions = [
    {
      name: 'app',
      type: 'autocomplete',
      message: 'Select an App',
      suffix: ':',
      source: (answers, input) => searchApps(input),
    },
    {
      name: 'testPreviews',
      type: 'list',
      message: 'Do you want to test preview apps?',
      choices: ['No', 'Yes'],
      filter: input => (input === 'Yes'),
    },
    {
      name: 'job',
      type: 'input',
      message: 'Test Name:',
      validate: isRequired,
    },
    {
      name: 'jobSpace',
      type: 'input',
      message: 'Test Space:',
      validate: isRequired,
    },
    {
      name: 'useAppImage',
      type: 'list',
      message: 'Is test suite an Akkeris app?',
      choices: ['Yes - select an app', 'No - specify an image'],
      filter: input => (input === 'Yes - select an app'),
    },
    {
      name: 'image',
      type: 'autocomplete',
      message: 'Select the test suite app',
      suffix: ':',
      source: (answers, input) => searchApps(input),
      when: answers => !!answers.useAppImage,
      filter: input => `akkeris://${input}`,
    },
    {
      name: 'image',
      type: 'input',
      message: 'Provide image location:',
      validate: isRequired,
      when: answers => !answers.useAppImage,
    },
    {
      name: 'override',
      type: 'list',
      message: 'Override command in docker image?',
      choices: ['No', 'Yes'],
      filter: input => (input === 'Yes'),
    },
    {
      name: 'command',
      type: 'input',
      message: 'Command:',
      validate: isRequired,
      when: answers => !!answers.override,
    },
    {
      name: 'autoPromote',
      type: 'list',
      message: 'Automatically promote?',
      choices: ['No', 'Yes'],
      filter: input => (input === 'Yes'),
    },
    {
      name: 'pipelineName',
      type: 'input',
      message: 'Pipeline Name:',
      validate: isRequired,
      when: answers => !!answers.autoPromote,
    },
    {
      name: 'transitionFrom',
      type: 'input',
      message: 'Transition From:',
      validate: isRequired,
      when: answers => !!answers.autoPromote,
    },
    {
      name: 'transitionTo',
      type: 'input',
      message: 'Transition To:',
      validate: isRequired,
      when: answers => !!answers.autoPromote,
    },
    {
      name: 'timeout',
      type: 'number',
      message: 'Timeout:',
      validate: isInteger,
    },
    {
      name: 'startDelay',
      type: 'number',
      message: 'Start Delay:',
      validate: isInteger,
    },
    {
      name: 'slackChannel',
      type: 'input',
      message: 'Slack Channel (no leading #):',
      validate: hasHash,
    },
    {
      name: 'envVars',
      type: 'input',
      message: 'Environment Variables:\n  (e.g. KEY="value" KEY2=value2)\n>',
      validate: validEnv,
    },
  ];

  try {
    console.log(appkit.terminal.markdown('\n###===### New Test Registration ###===###'));
    console.log(appkit.terminal.markdown('###(Press [CTRL+C] to cancel at any time)###\n'));

    const answers = await inquirer.prompt(questions);
    const diagnostic = {
      app: answers.app.split('-')[0],
      space: answers.app.split('-').slice(1).join('-'),
      action: 'release',
      result: 'succeeded',
      job: answers.job,
      jobspace: answers.jobSpace,
      image: answers.image,
      command: answers.override ? answers.command : undefined,
      pipelinename: answers.autoPromote ? answers.pipelineName : 'manual',
      transitionfrom: answers.autoPromote ? answers.transitionFrom : 'manual',
      transitionto: answers.autoPromote ? answers.transitionTo : 'manual',
      timeout: answers.timeout,
      startdelay: answers.startDelay,
      slackchannel: answers.slackChannel,
      testpreviews: answers.testPreviews,
      env: answers.envVars
        .replace(/"/g, '')
        .split(' ')
        .map(env => ({
          name: env.split('=')[0],
          value: env.split('=')[1],
        }))
        .filter(e => e.name && e.value),
    };
    const resp = await appkit.api.post(JSON.stringify(diagnostic), `${DIAGNOSTICS_API_URL}/v1/diagnostic`);
    appkit.terminal.vtable(resp);
    args.ID = `${answers.job}-${answers.jobSpace}`; // eslint-disable-line
    addHooks(appkit, args); // This will be removed soon
  } catch (err) {
    appkit.terminal.error(parseError(err));
  }
}

async function getLogs(appkit, args) {
  let uuid = '';
  try {
    if (isUUID(args.ID)) {
      uuid = args.ID;
    } else {
      const resp = await appkit.http.get(`${DIAGNOSTICS_API_URL}/v1/diagnostic/${args.ID}`, jsonType);
      const { runs } = await appkit.http.get(
        `${DIAGNOSTICS_API_URL}/v1/diagnostic/jobspace/${resp.jobspace}/job/${resp.job}/runs`,
        jsonType,
      );
      if (!runs) { throw new Error('no runs'); }
      uuid = runs.pop().id;
    }
    const logArray = await appkit.http.get(`${DIAGNOSTICS_API_URL}/v1/diagnostic/logs/${uuid}/array`, plainType);
    logArray.forEach(line => console.log(line));
  } catch (err) {
    appkit.terminal.error(parseError(err));
  }
}

async function listRuns(appkit, args) {
  try {
    const resp = await appkit.http.get(`${DIAGNOSTICS_API_URL}/v1/diagnostic/${args.ID}`, jsonType);
    const { runs } = await appkit.http.get(
      `${DIAGNOSTICS_API_URL}/v1/diagnostic/jobspace/${resp.jobspace}/job/${resp.job}/runs`,
      { 'Content-Type': 'application/json' },
    );

    if (!runs) {
      throw new Error('No runs!');
    }

    appkit.terminal.table(runs.map(runItem => ({
      runid: runItem.id,
      app: `${runItem.app}-${runItem.space}`,
      test: `${runItem.job}-${runItem.jobspace}`,
      time: runItem.hrtimestamp,
      status: appkit.terminal.markdown(runItem.overallstatus === 'success' ? '^^ success ^^' : `!! ${runItem.overallstatus} !!`),
    })));
  } catch (err) {
    appkit.terminal.error(parseError(err));
  }
}

async function updateJob(appkit, args) {
  const property = args.p || args.property;
  const value = args.v || args.value;
  try {
    const resp = await appkit.http.get(`${DIAGNOSTICS_API_URL}/v1/diagnostic/${args.ID}`, jsonType);

    if (property === 'timeout' || property === 'startdelay') {
      resp[property] = parseInt(value, 10);
    } else if (property === 'env') {
      const env = value.toString().split(' ').map(pair => ({
        name: pair.split('=')[0],
        value: pair.split('=')[1],
      }));
      resp[property] = env;
    } else if (property === 'testpreviews') {
      resp[property] = value === 'true' || value === 't';
    } else {
      resp[property] = value;
    }

    const resp2 = await appkit.api.patch(JSON.stringify(resp), `${DIAGNOSTICS_API_URL}/v1/diagnostic`);
    appkit.terminal.vtable(resp2);
  } catch (err) {
    appkit.terminal.error(parseError(err));
  }
}

async function job(appkit, args) {
  try {
    const jobItem = await appkit.http.get(`${DIAGNOSTICS_API_URL}/v1/diagnostic/${args.ID}`, jsonType);
    if (jobItem.ispreview) {
      console.log(appkit.terminal.markdown('###===### !!Preview App Test!! ###===###'));
    }
    console.log(appkit.terminal.markdown('^^ properties: ^^'));
    appkit.terminal.vtable({
      id: jobItem.id,
      test: `${jobItem.job}-${jobItem.jobspace}`,
      app: `${jobItem.app}-${jobItem.space}`,
      testpreviews: jobItem.testpreviews,
      action: jobItem.action,
      result: jobItem.result,
      image: jobItem.image,
      pipelinename: jobItem.pipelinename,
      transitionfrom: jobItem.transitionfrom,
      transitionto: jobItem.transitionto,
      timeout: jobItem.timeout,
      startdelay: jobItem.startdelay,
      slackchannel: jobItem.slackchannel,
      command: jobItem.command ? jobItem.command : 'Default command in image',
    });
    console.log(appkit.terminal.markdown('^^ env: ^^'));
    if (jobItem.env) {
      appkit.terminal.table(jobItem.env);
    } else {
      console.log(appkit.terminal.markdown('  ***n/a***'));
    }
  } catch (err) {
    appkit.terminal.error(parseError(err));
  }
}

async function listConfig(appkit, args) {
  const simple = args.s || args.simple;
  const exports = args.e || args.exports;
  try {
    const { env } = await appkit.http.get(`${DIAGNOSTICS_API_URL}/v1/diagnostic/${args.ID}`, jsonType);
    if (!env) {
      console.log(appkit.terminal.markdown(`\nNo environment variables set on ***${args.ID}***!`));
    } else {
      if (!simple && !exports) {
        appkit.terminal.table(env);
      }
      if (simple) {
        env.forEach(x => console.log(`${x.name}=${x.value}`));
      }
      if (exports) {
        env.forEach(x => console.log(`export ${x.name}=${x.value}`));
      }
    }
  } catch (err) {
    appkit.terminal.error(parseError(err));
  }
}

async function deleteTest(appkit, args) {
  try {
    await appkit.api.delete(`${DIAGNOSTICS_API_URL}/v1/diagnostic/${args.ID}`);
    console.log(appkit.terminal.markdown('^^ deleted ^^'));
  } catch (err) {
    appkit.terminal.error(parseError(err));
  }
}

function colorize(text, colorname) { // eslint-disable-line
  return text;
}

async function images(appkit) {
  try {
    const tests = await appkit.http.get(`${DIAGNOSTICS_API_URL}/v1/diagnostics?simple=true`, jsonType);
    const colorList = ['', 'green', 'blue', 'yellow', 'orange', 'purple', 'red'];
    const colorImageMap = {};
    let currentColor = 0;
    let currentImage = '';

    appkit.terminal.table(tests.map((test) => {
      const imageNameAndTag = test.image.split('/').pop();
      if (imageNameAndTag !== currentImage && !colorImageMap[imageNameAndTag] > 0) {
        currentColor += 1;
        colorImageMap[imageNameAndTag] = currentColor;
      }
      currentImage = imageNameAndTag;
      return {
        image: colorize(
          imageNameAndTag,
          colorList[colorImageMap[imageNameAndTag]] || colorList[currentColor],
        ),
        test: `${test.job}-${test.jobspace}`,
        app: `${test.app}-${test.space}`,
        id: test.id,
      };
    }));
  } catch (err) {
    appkit.terminal.error(parseError(err));
  }
}

async function list(appkit) {
  try {
    const tests = await appkit.http.get(`${DIAGNOSTICS_API_URL}/v1/diagnostics?simple=true`, jsonType);
    if (!tests || tests.length === 0) {
      appkit.terminal.error(appkit.terminal.markdown('No tests found. Register a test with ^^aka taas:tests:register^^'));
      return;
    }
    appkit.terminal.table(tests.map(test => ({
      id: test.id,
      test: `${test.job}-${test.jobspace}`,
      app: `${test.app}-${test.space}`,
      action: test.action,
      result: test.result,
      preview: test.ispreview ? 'true' : 'false',
    })));
  } catch (err) {
    appkit.terminal.error(parseError(err));
  }
}

async function artifacts(appkit, args) {
  try {
    const { _source: source } = await appkit.http.get(`${DIAGNOSTICS_API_URL}/v1/diagnostics/runs/info/${args.ID}`, plainType);
    if (typeof source.job === 'undefined' || source.job === '') {
      appkit.terminal.error(appkit.terminal.markdown('!!Invalid run ID!!'));
      return;
    }
    console.log(appkit.terminal.markdown(`\n~~Artifacts:~~ ${DIAGNOSTICS_API_URL}/v1/artifacts/${args.ID}/`));
    if (process.platform === 'darwin') {
      console.log(appkit.terminal.markdown('###CMD + Click to open###'));
    }
  } catch (err) {
    appkit.terminal.error(parseError(err));
  }
}

function formatRun(appkit, run) {
  return {
    status: appkit.terminal.markdown(`${run.overallstatus === 'starting' ? '~~●~~' : '^^●^^'} ${run.overallstatus}`),
    id: run.runid,
    app: `${run.app}-${run.space}`,
    test: `${run.job}-${run.jobspace}`,
    image: run.image,
    started: new Date(run.run_on || run.starttime).toLocaleTimeString(),
    timeout: run.timeout || 'cron',
  };
}

async function currentRuns(appkit) {
  try {
    const data = await appkit.http.get(`${DIAGNOSTICS_API_URL}/v1/status/runs`);
    const results = []
      .concat(data.current_runs ? data.current_runs.map(run => formatRun(appkit, run)) : [])
      .concat(data.current_cron_runs ? data.current_cron_runs.map(run => formatRun(appkit, run)) : []);
    if (results.length === 0) {
      console.log(appkit.terminal.markdown('**No tests are currently running...**'));
    } else {
      appkit.terminal.table(results);
    }
  } catch (err) {
    appkit.terminal.error(err);
  }
}

function update() {}

function init(appkit) {
  const updateOpts = {
    property: {
      alias: 'p',
      string: true,
      description: 'property name (timeout, transitionfrom, env, etc).',
      choices: ['image', 'pipelinename', 'transitionfrom', 'transitionto', 'timeout', 'startdelay', 'slackchannel', 'command', 'testpreviews'],
      demand: true,
    },
    value: {
      alias: 'v',
      string: true,
      description: 'new value of the property. If updating slackchannel, do not include leading #',
      demand: true,
    },
  };

  const secretOpts = {
    plan: {
      alias: 'p',
      string: true,
      description: 'plan name (example: xisoap-ws:dev)',
      demand: true,
    },
  };

  const listConfigOpts = {
    simple: {
      alias: 's',
      boolean: true,
      description: 'show as simple list',
      demand: false,
    },
    exports: {
      alias: 'e',
      boolean: true,
      description: 'show as exports',
      demand: false,
    },
  };

  const multiSetOpts = {
    suffix: {
      alias: 's',
      string: true,
      description: 'filter by suffix',
      demand: false,
    },
    prefix: {
      alias: 'p',
      string: true,
      description: 'filter by prefix',
      demand: false,
    },
  };
  const cronOpts = {
    cronspec: {
      alias: 's',
      string: true,
      description: 'cronjob spec',
      demand: true,
    },
    command: {
      alias: 'c',
      string: true,
      description: 'cronjob alternate command to container',
      demand: false,
    },
  };

  const cronRunsOpts = {
    number: {
      alias: 'n',
      string: true,
      description: 'number of runs',
      demand: false,
    },
    filter: {
      alias: 'f',
      string: true,
      descriptioon: 'filter',
      choices: ['failed', 'success', 'pass', 'borked', 'fail', 'passed', 'pizzled'],
      demand: false,
    },
  };

  appkit.args
    .command('taas:tests', 'List tests', {}, list.bind(null, appkit))
    .command('taas:images', 'List images', {}, images.bind(null, appkit))
    .command('taas:tests:info ID', 'Describe test', {}, job.bind(null, appkit))
    .command('taas:tests:register', 'Register test', {}, newRegister.bind(null, appkit))
    .command('taas:tests:update ID', 'Update test', updateOpts, updateJob.bind(null, appkit))
    .command('taas:tests:destroy ID', 'Delete test', {}, deleteTest.bind(null, appkit))
    .command('taas:tests:trigger ID', 'Trigger a test', {}, trigger.bind(null, appkit))
    .command('taas:tests:runs ID', 'List test runs', {}, listRuns.bind(null, appkit))
    .command('taas:config ID', 'List environment variables', listConfigOpts, listConfig.bind(null, appkit))
    .command('taas:config:set ID KVPAIR', 'Set an environment variable', {}, setVar.bind(null, appkit))
    .command('taas:config:unset ID VAR', 'Unset an environment variable', {}, unsetVar.bind(null, appkit))
    .command('taas:secret:create ID', 'Add a secret to a test', secretOpts, addSecret.bind(null, appkit))
    .command('taas:secret:remove ID', 'Remove a secret from a test', secretOpts, removeSecret.bind(null, appkit))
    .command('taas:hooks:create ID', 'Add testing hooks to a test\'s target app', {}, addHooks.bind(null, appkit))
    .command('taas:runs:info ID', 'Get info for a run', {}, runInfo.bind(null, appkit))
    .command('taas:runs:output ID', 'Get logs for a run. If ID is a test name, gets latest', {}, getLogs.bind(null, appkit))
    .command('taas:runs:rerun ID', 'Reruns a run', {}, reRun.bind(null, appkit))
    .command('taas:runs:artifacts ID', 'Get link to view artifacts for a run', {}, artifacts.bind(null, appkit))
    .command('taas:logs ID', 'Get logs for a run. If ID is a test name, gets latest', {}, getLogs.bind(null, appkit))
    .command('taas:running', 'List currently running tests', {}, currentRuns.bind(null, appkit))
    .command('taas:runs:current', false, {}, currentRuns.bind(null, appkit)); // alias

  if (process.env.TAAS_BETA === 'true') {
    appkit.args.command('taas:config:multiset KVPAIR', 'BETA: set an environment variable across multiple tests by prefix or suffix', multiSetOpts, multiSet.bind(null, appkit));
    appkit.args.command('taas:config:multiunset KEY', 'BETA: unset an environment variable across multiple tests by prefix or suffix', multiSetOpts, multiUnSet.bind(null, appkit));
    appkit.args.command('taas:tests:audits ID', 'BETA: Get audits for a test', {}, audits.bind(null, appkit));
    appkit.args.command('taas:tail ID', 'BETA: Tail Logs', {}, taillogs.bind(null, appkit));
    appkit.args.command('taas:cron:jobs', 'BETA: Get cronjobs', {}, getcronjobs.bind(null, appkit));
    appkit.args.command('taas:cron:destroy ID', 'BETA: Destroy cronjob', {}, destroycronjob.bind(null, appkit));
    appkit.args.command('taas:cron:create ID', 'BETA: Create cronjob', cronOpts, createcronjob.bind(null, appkit));
    appkit.args.command('taas:cron:runs ID', 'BETA: Get cronjob runs', cronRunsOpts, getcronjobruns.bind(null, appkit));
  }
}

module.exports = {
  init,
  update,
  group: 'taas',
  help: 'manage testing as a service (create, list, register, update)',
  primary: true,
};

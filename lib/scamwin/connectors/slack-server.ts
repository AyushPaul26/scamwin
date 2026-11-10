import 'server-only';
import type {SlackManualService} from './slack-manual';
import type {SlackSetupService} from './slack-setup';
import type {SlackWebhookService} from './slack-webhook';
import {ConnectorStoreError} from './store';
export interface SlackServices {setup:SlackSetupService;manual:SlackManualService;webhook:SlackWebhookService;signingSecret:string;appId:string}
let factory:(()=>SlackServices)|undefined;
export function registerSlackServices(value:()=>SlackServices){factory=value;}
export function slackServices(){if(process.env.SCAMWIN_CONNECTORS_ENABLED!=='true'||process.env.SCAMWIN_CONNECTOR_SLACK_ENABLED!=='true'||!factory)throw new ConnectorStoreError('provider_unavailable');return factory();}

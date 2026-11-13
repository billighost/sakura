import {beginClientJourney} from "./rebuild/app/clientPerformance";
beginClientJourney("startup");
export function onRouterTransitionStart(){beginClientJourney("navigation");}

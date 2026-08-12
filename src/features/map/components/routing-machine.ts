import L from "leaflet";
import userLocationIcon from "./user-location-marker";
import { createControlComponent } from "@react-leaflet/core";
import "leaflet-routing-machine";

interface RoutingMachineProps extends L.ControlOptions {
  waypoints: L.LatLng[];
}

const createRoutineMachineLayer = (props: RoutingMachineProps) => {
  const instance = L.Routing.control({
    collapsible: true,
    plan: L.Routing.plan(props.waypoints, {
      addWaypoints: false,
      draggableWaypoints: true,
      createMarker: function (i: number, waypoint: L.Routing.Waypoint) {
        if (i === 0) {
          return L.marker(waypoint.latLng, {
            icon: userLocationIcon
          });
        }
        return false;
      }
    }),
    lineOptions: {
      styles: [{ color: "#6FA1EC", weight: 4 }],
      extendToWaypoints: true,
      missingRouteTolerance: 100
    },
    routeWhileDragging: true,
    show: true,
    fitSelectedRoutes: true,
    showAlternatives: false,
    formatter: new L.Routing.Formatter({
      units: "imperial",
      distanceTemplate: '{value} {unit}'
    }),
    summaryTemplate: '<h2>{name}</h2><h3>{distance}, {time}</h3>'
  } as L.Routing.RoutingControlOptions & { collapsed: boolean });

  return instance;
};

const RoutingMachine = createControlComponent<L.Routing.Control, RoutingMachineProps>(
  createRoutineMachineLayer
);

export default RoutingMachine;

interface MapDestination {
  name: string;
  address: string;
}

export const getWebDirectionsUrl = ({ address }: MapDestination) =>
  `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}&travelmode=driving`;

export const getPreferredDirectionsUrl = (destination: MapDestination) => {
  const address = encodeURIComponent(destination.address);
  const label = encodeURIComponent(destination.name);
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  if (isIOS) {
    return `https://maps.apple.com/?daddr=${address}&dirflg=d&q=${label}`;
  }

  if (/Android/i.test(navigator.userAgent)) {
    return `google.navigation:q=${address}&mode=d`;
  }

  return getWebDirectionsUrl(destination);
};

export const openPreferredDirections = (destination: MapDestination) => {
  window.open(getPreferredDirectionsUrl(destination), '_blank', 'noopener,noreferrer');
};

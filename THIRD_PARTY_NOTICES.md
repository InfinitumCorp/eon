# Third-party notices

These datasets are not stored in this repository. `npm run geo:fetch` downloads the pinned bytes into `data/geo/`, which is gitignored, and checks them against `data/geo.lock.json` and the publisher's `.sha256sum` assets. Loyalsoldier and sing-box geo builds are not used.

The product reads them only when `INFINITUM_GEO_ENABLED` is set. That path is an observe-only cyber annotation of the connecting address and the request host. It does not allow or refuse a request.

## geoip.dat

- Work: `geoip.dat`
- Source: [v2fly/geoip](https://github.com/v2fly/geoip) release [202611080027](https://github.com/v2fly/geoip/releases/tag/202611080027)
- Asset: `geoip.dat`
- SHA-256: `eedb24b3b9fcba27e06b92c0428dab90d9496083091ae4cf39e11387fd99d0e2`
- Saved as: `data/geo/geoip.dat` (unmodified)
- License: [Creative Commons Attribution-ShareAlike 4.0 International (CC-BY-SA-4.0)](https://creativecommons.org/licenses/by-sa/4.0/)
- Copyright: v2fly/geoip contributors

IP geolocation data by [DB-IP](https://db-ip.com), licensed under [Creative Commons Attribution 4.0 International (CC-BY-4.0)](https://creativecommons.org/licenses/by/4.0/). v2fly/geoip converts that data and releases `geoip.dat` under CC-BY-SA-4.0. No changes are made to the downloaded bytes. Anyone who redistributes those bytes must keep this attribution and share the dataset under CC-BY-SA-4.0.

## geosite.dat

- Work: domain list community data file `dlc.dat`, saved locally as `geosite.dat`
- Source: [v2fly/domain-list-community](https://github.com/v2fly/domain-list-community) release [20261108011013](https://github.com/v2fly/domain-list-community/releases/tag/20261108011013)
- Asset: `dlc.dat` (bytes unmodified; only the local filename differs)
- SHA-256: `dc4192dd1b644a38276ed06136d26e729fa674d25785adb38c87e040e92376b2`
- Saved as: `data/geo/geosite.dat`
- License: MIT
- Copyright: Copyright (c) 2018-2019 V2Ray

```
MIT License

Copyright (c) 2018-2019 V2Ray

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

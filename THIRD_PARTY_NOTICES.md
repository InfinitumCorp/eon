# Third-party notices

E(O)N™ MIL does not ship these files in git. `npm run fetch-geo` downloads the pinned bytes into `data/geo/`, checks them against the official `.sha256sum` assets and `geo/geo.lock.json`, and stops on a mismatch. The bytes are unmodified.

Loyalsoldier and sing-box geo datasets are not used. Those distributions are GPL-3.0.

## geoip.dat

| | |
|---|---|
| File | `data/geo/geoip.dat` |
| Project | [v2fly/geoip](https://github.com/v2fly/geoip) |
| Release | [202611080027](https://github.com/v2fly/geoip/releases/tag/202611080027) asset `geoip.dat` |
| SHA-256 | `eedb24b3b9fcba27e06b92c0428dab90d9496083091ae4cf39e11387fd99d0e2` |
| License | [CC-BY-SA-4.0](https://creativecommons.org/licenses/by-sa/4.0/) |

The v2fly geoip project is licensed under CC-BY-SA-4.0. Its published geoip.dat is built from the free IP geolocation data by [DB-IP](https://db-ip.com), which is licensed under [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/).

Attribution: IP geolocation data by DB-IP, compiled and published by the v2fly geoip project. No modifications. Share-alike applies if you redistribute a modified copy of the dataset.

## geosite.dat

| | |
|---|---|
| File | `data/geo/geosite.dat` (the release asset is `dlc.dat`; it is saved under this name) |
| Project | [v2fly/domain-list-community](https://github.com/v2fly/domain-list-community) |
| Release | [20261108011013](https://github.com/v2fly/domain-list-community/releases/tag/20261108011013) asset `dlc.dat` |
| SHA-256 | `dc4192dd1b644a38276ed06136d26e729fa674d25785adb38c87e040e92376b2` |
| License | MIT |

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

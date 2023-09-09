..
   SPDX-FileCopyrightText: (c) 2016 ale5000
   SPDX-License-Identifier: GPL-3.0-or-later
   SPDX-FileType: DOCUMENTATION

========
CONTENTS
========
.. |star| replace:: ⭐️
.. |fire| replace:: 🔥
.. |boom| replace:: 💥
.. |yes| replace:: ✔
.. |no| replace:: ✖
.. |red-no| replace:: ❌
.. |no-upd| replace:: 🙈


Apps
----

+----------------------------------------------------------------------------------------+---------------+-----------------------+------------------------------+
|                                                                                        |  Android ver. |    Updatable with     |            Signer            |
|                                      Application                                       +-------+-------+----------+------------+----------+--------+----------+
|                                                                                        |  Min  |  Max  | F-Droid  | Play Store | F-Droid  | Author | ale5000  |
+========================================================================================+=======+=======+==========+============+==========+========+==========+
| `microG Services 0.2.28.233013-79 (5918d12) <origin/priv-app/GmsCore-ale5000.apk>`_    |  4.0  |       |  |no|    |    |no|    |          |        |  |fire|  |
+----------------------------------------------------------------------------------------+-------+-------+----------+------------+----------+--------+----------+
| `microG Services 0.2.28.231657-28 (a749fe4) <origin/priv-app/GmsCore.apk>`_            |  4.0  |       |  |yes|   |    |no|    |          | |fire| |          |
+----------------------------------------------------------------------------------------+-------+-------+----------+------------+----------+--------+----------+
| `microG Services 0.2.13.203915-vtm <origin/priv-app/GmsCoreVtm.apk>`_                  |  4.0  |       | |no-upd| |    |no|    |          | |fire| |          |
+----------------------------------------------------------------------------------------+-------+-------+----------+------------+----------+--------+----------+
| `microG Services 0.2.6.13280-vtm (legacy) <origin/priv-app/GmsCoreVtmLegacy.apk>`_     |  2.3  | 3.2.6 | |no-upd| |    |no|    |          | |fire| |          |
+----------------------------------------------------------------------------------------+-------+-------+----------+------------+----------+--------+----------+
| `microG Services Framework Proxy 0.1.0-9-gf3db29c <origin/priv-app/GsfProxy.apk>`_     |  2.3  |       |  |no|    |    |no|    |          |        |  |fire|  |
+----------------------------------------------------------------------------------------+-------+-------+----------+------------+----------+--------+----------+
| `microG Companion (FakeStore) 0.2.0-4-gc49ebe1 <origin/priv-app/FakeStore.apk>`_       |  2.3  |       |  |no|    |    |no|    |          |        |  |fire|  |
+----------------------------------------------------------------------------------------+-------+-------+----------+------------+----------+--------+----------+
| `F-Droid Privileged Extension 0.2.13 <origin/priv-app/FDroidPrivilegedExtension.apk>`_ |  2.2  |       |  |yes|   |    |no|    |  |fire|  | |fire| |          |
+----------------------------------------------------------------------------------------+-------+-------+----------+------------+----------+--------+----------+
| `Aurora Services 1.1.1 <origin/priv-app/AuroraServices.apk>`_                          |  5.0  |       |  |no|    |    |no|    |          | |fire| |          |
+----------------------------------------------------------------------------------------+-------+-------+----------+------------+----------+--------+----------+
| `UnifiedNlp 1.6.8 (legacy) <origin/app/LegacyNetworkLocation.apk>`_                    |  2.3  | 4.3.1 |  |yes|   |    |no|    |  |fire|  |        |          |
+----------------------------------------------------------------------------------------+-------+-------+----------+------------+----------+--------+----------+
| `NewPipe 0.25.2 <origin/app/NewPipe.apk>`_                                             |  5.0  |       |  |yes|   |    |no|    |          | |fire| |          |
+----------------------------------------------------------------------------------------+-------+-------+----------+------------+----------+--------+----------+
| `NewPipe 0.23.3 (old) <origin/app/NewPipeOld.apk>`_                                    |  4.4  | 4.4.4 | |no-upd| |    |no|    |  |fire|  |        |          |
+----------------------------------------------------------------------------------------+-------+-------+----------+------------+----------+--------+----------+
| `NewPipe Legacy 0.20.8 <origin/app/NewPipeLegacy.apk>`_                                |  4.1  | 4.3.1 | |no-upd| |    |no|    |  |fire|  |        |          |
+----------------------------------------------------------------------------------------+-------+-------+----------+------------+----------+--------+----------+
| [#]_ Google Play Store 7.1.25.I-all (137772785) - nodpi |boom|                         |  6.0  |       |  |no|    |    |yes|   |          | |fire| |          |
+----------------------------------------------------------------------------------------+-------+-------+----------+------------+----------+--------+----------+
| [#]_ Google Play Store 5.1.11 (80310011) - nodpi |boom|                                |  2.3  | 5.1.1 |  |no|    |    |yes|   |          | |fire| |          |
+----------------------------------------------------------------------------------------+-------+-------+----------+------------+----------+--------+----------+
| [#]_ Android Auto 1.2.520120-stub (12520120) |boom|                                    |  6.0  |       |  |no|    |    |yes|   |          | |fire| |          |
+----------------------------------------------------------------------------------------+-------+-------+----------+------------+----------+--------+----------+


Notes
-----
.. [#] <origin/priv-app/PlayStore.apk>
.. [#] <origin/priv-app/PlayStoreLegacy.apk>
.. [#] <origin/priv-app/AndroidAuto.apk>
|boom| *Only in the full version*.

..
   https://microg.org/dl/core-nightly.apk


UnifiedNlp backends (only installed when microG Services <= 0.2.27 are installed)
---------------------------------------------------------------------------------
- **origin/app/DejaVuBackend.apk** => Déjà Vu Location Service 1.1.12 |star| |fire|
- **origin/app/IchnaeaNlpBackend.apk** => Mozilla UnifiedNlp Backend 1.5.0 |star| |fire|
- **origin/app/NominatimGeocoderBackend.apk** => Nominatim Geocoder Backend 1.2.2 |star| |fire|


Framework library
-----------------
- **files/framework/com.google.android.maps.jar** => microG Maps API v1 0.1.0 |fire|


Scripts
-------
- microG / GApps removal script


Components used only during setup (not installed)
-------------------------------------------------
- BusyBox for Android (available `here <https://forum.xda-developers.com/showthread.php?t=3348543>`_) - See `here <misc/README.rst>`_ for more info

|

|star| *Can be updated through F-Droid*.

|fire| *Original version*.

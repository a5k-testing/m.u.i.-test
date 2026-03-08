############
Instructions
############
..
   SPDX-FileCopyrightText: (c) 2016 ale5000
   SPDX-License-Identifier: GPL-3.0-or-later
   SPDX-FileType: DOCUMENTATION

This package comes in 2 flavours:

- One is complete;
- One include only open-source components.

You can build it yourself or download the prebuilt version.


Prerequisites
=============

- An Android device running Android **2.2 or later**.
- A custom recovery (e.g. `TWRP <https://twrp.me/>`_) **or** root access with ADB.
- At least **100 MB** of free space on the system partition (actual requirements vary by device and selected options).


Download
========

You can find the stable releases here:

- `Stable - Full flavour <https://xdaforums.com/t/3432360/>`_
- `Stable - OSS flavour <https://github.com/micro5k/microg-unofficial-installer/releases/latest>`_

Instead if you want to try the nightly builds you can find them here:

- `Nightly - Full flavour <https://gitlab.com/micro5k/microg-unofficial-installer/-/jobs/artifacts/main/browse/output?job=build-job>`_
- `Nightly - OSS flavour <https://github.com/micro5k/microg-unofficial-installer/releases/tag/nightly>`_

**NOTE:** If you get the error "No space left on device", you can find a workaround in `Known issues <KNOWN_ISSUES.rst>`_.


Installation
============

Via custom recovery (TWRP)
--------------------------

1. Transfer the downloaded zip to your device's internal storage or SD card.
2. Reboot into recovery (hold **Power + Volume Down** — exact key combination depends on your device).
3. In TWRP, tap **Install**, navigate to the zip file and select it.
4. Swipe to confirm the flash.
5. Once complete, tap **Reboot System**.

Via ADB sideload
----------------

1. Reboot into recovery.
2. In TWRP, tap **Advanced** → **ADB Sideload**, then swipe to start.
3. On your PC, run:

   .. code-block:: sh

      adb sideload microg-unofficial-installer-*.zip

4. Once the transfer finishes, reboot the device.

Via ``zip-install.sh`` (root + ADB, no recovery needed)
--------------------------------------------------------

This method installs the zip from a running Android system using ``zip-install.sh``.
Requires root access or an ADB connection with sufficient privileges.

1. Transfer the zip to your PC.
2. Connect your device via USB with USB debugging enabled.
3. Run:

   .. code-block:: sh

      bash zip-install.sh

   The script will push the zip to the device and trigger the installation automatically.

4. Follow the on-screen prompts for the live setup (e.g. choose which optional apps to install).

.. tip::
   You can pre-configure options before flashing by setting system properties.
   For example, to enable a longer live setup timeout:

   .. code-block:: sh

      adb shell "setprop zip.microg-unofficial-installer.LIVE_SETUP_TIMEOUT 8"


Uninstallation
==============

To remove microG and all components installed by this zip, re-flash the zip and
select **Uninstall** in the live setup menu, or run:

.. code-block:: sh

   bash zip-install.sh --uninstall


Build
=====

``./gradlew buildOta``
or
``./gradlew buildOtaOSS``

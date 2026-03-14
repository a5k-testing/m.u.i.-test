###########################
Build the flashable OTA zip
###########################
..
   SPDX-FileCopyrightText: (c) 2026 ale5000
   SPDX-License-Identifier: GPL-3.0-or-later
   SPDX-FileType: DOCUMENTATION

.. contents:: Build methods:
   :local:
   :depth: 1
   :backlinks: none


Prerequisites
=============

All build methods require:

- **Java 17** — the build toolchain requires Java 17 or later.
  The CI uses the `Eclipse Temurin <https://adoptium.net/>`_ distribution, which is also recommended locally.
  If you use `asdf <https://asdf-vm.com/>`_, run ``asdf install`` in the project root to install the exact version defined in ``.tool-versions``.

- **Bash** — the main build script (``build.sh``) requires Bash.
  It is pre-installed on Linux and macOS.
  On Windows, use `Git Bash <https://git-scm.com/downloads>`_ or `WSL <https://learn.microsoft.com/en-us/windows/wsl/install>`_.

Additional requirement depending on the build method:

- **make / pdpmake** — for the ``make`` build method.
- **Gradle wrapper** — for the ``./gradlew`` build method: no separate installation is needed; the wrapper (``gradlew`` / ``gradlew.bat``) included in the repository downloads the correct Gradle version automatically.
- **VS Code** — for the VS Code build method: install `Visual Studio Code <https://code.visualstudio.com/>`_.


make / pdpmake
==============

Full flavour
------------

Includes all components (proprietary and open-source):

.. code-block:: sh

   make buildota

Open-source flavour
-------------------

Includes only open-source components:

.. code-block:: sh

   make buildotaoss

Test the build
--------------

Emulates an Android recovery on the PC and runs the produced zip inside it:

.. code-block:: sh

   make test

.. note::
   Run ``buildota`` or ``buildotaoss`` first so that the zip exists in the ``output/`` folder.


`Gradle wrapper <https://docs.gradle.org/current/userguide/gradle_wrapper.html>`_
=================================================================================

Full flavour
------------

Includes all components (proprietary and open-source):

.. code-block:: sh

   ./gradlew buildOta

Open-source flavour
-------------------

Includes only open-source components:

.. code-block:: sh

   ./gradlew buildOtaOSS

Test the build
--------------

Emulates an Android recovery on the PC and runs the produced zip inside it:

.. code-block:: sh

   ./gradlew installTest

.. note::
   Run ``buildOta`` or ``buildOtaOSS`` first so that the zip exists in the ``output/`` folder.


`VS Code <https://code.visualstudio.com/>`_
===========================================

Full flavour
------------

Includes all components (proprietary and open-source):

Open the project in VS Code and run the ``buildOta`` task.

Open-source flavour
-------------------

Includes only open-source components:

Open the project in VS Code and run the ``buildOtaOSS`` task.

Test the build
--------------

Emulates an Android recovery on the PC and runs the produced zip inside it:

Open the project in VS Code and run the ``installTest`` task.

.. note::
   Run ``buildOta`` or ``buildOtaOSS`` first so that the zip exists in the ``output/`` folder.

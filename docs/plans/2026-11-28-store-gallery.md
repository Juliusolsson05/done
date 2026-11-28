# Done on iPhone and iPad

Show a fictional studio planning an open house. Capture its actual Today, Notes, Upcoming and Board screens in the iOS app on both device families. Protect every sample from contact with production data by writing only into a newly installed simulator.

Keep promotional headlines short, set them in HTML above large, readable app screenshots, and leave a few screens unframed. Inspect the exported PNGs at listing size, then verify that App Store Connect has processed each family.

## Gallery verification

- Run [46116467997](https://github.com/Juliusolsson05/done/actions/runs/46116467997) yielded four verified iPhone views and one verified iPad view. The iPad Board and Notes attachments both showed Today, and the iPad Upcoming test failed. Gallery selection uses the visible app content.
- The preview has five iPhone portraits at 1320 × 2868 and three iPad portraits at 2064 × 2752. Native synthetic captures from the earlier Garden gathering workspace supply iPhone Lists and iPad Notes and Focus. A native iPad landscape Notes view and the paired device graphic are available separately.
- The render uses a device pixel ratio of one. The app occupies about 1122 × 2391 visible pixels in each framed iPhone export and 1874 × 2287 in each framed iPad export. The local gallery includes direct PNG links and 100% crops for inspection.
- The capture test now taps visible sidebar controls and checks each destination for distinctive content. The iOS Simulator SDK typecheck passed. A simulator run remains necessary to verify iPad Board and Upcoming and replace earlier workspace captures if a single fixture is required throughout. App Store Connect processing remains pending.

The supplemental run uses only the 13-inch iPad and the simulator app from run 46099340426, build 298. Today is the control. Board and Upcoming are the missing views, and Notes and Focus replace the earlier workspace captures. The initial iPad job ran for about 8½ minutes. Expect about 9 minutes for the retry, with an 18-minute Actions limit. A passing result must include five native 2064 × 2752 captures with the expected views. A failed result retains the attachments and test log for diagnosis.

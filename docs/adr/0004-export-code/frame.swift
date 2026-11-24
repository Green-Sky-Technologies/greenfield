ZStack(alignment: .topLeading) {
    HStack(alignment: .center, spacing: 0) {
        Text("9:41")
            .font(.custom("Inter", size: 15).weight(.semibold))
            .foregroundColor(Color(red: 0.06, green: 0.09, blue: 0.16, opacity: 1))
        HStack(alignment: .center, spacing: 6) {
            HStack(alignment: .center, spacing: 2) {
                RoundedRectangle(cornerRadius: 1)
                    .fill(Color(red: 0.06, green: 0.09, blue: 0.16, opacity: 1))
                    .frame(width: 3, height: 4)
                RoundedRectangle(cornerRadius: 1)
                    .fill(Color(red: 0.06, green: 0.09, blue: 0.16, opacity: 1))
                    .frame(width: 3, height: 6)
                RoundedRectangle(cornerRadius: 1)
                    .fill(Color(red: 0.06, green: 0.09, blue: 0.16, opacity: 1))
                    .frame(width: 3, height: 8)
                RoundedRectangle(cornerRadius: 1)
                    .fill(Color(red: 0.06, green: 0.09, blue: 0.16, opacity: 1))
                    .frame(width: 3, height: 10)
            }
                .frame(width: 18, height: 10, alignment: .topLeading)
            ZStack(alignment: .topLeading) {
                RoundedRectangle(cornerRadius: 1.5)
                    .fill(Color(red: 0.06, green: 0.09, blue: 0.16, opacity: 1))
                    .frame(width: 17, height: 8)
                    .offset(x: 2, y: 2)
            }
                .frame(width: 25, height: 12, alignment: .topLeading)
                .clipShape(RoundedRectangle(cornerRadius: 3.5))
                .overlay(RoundedRectangle(cornerRadius: 3.5).stroke(Color(red: 0.06, green: 0.09, blue: 0.16, opacity: 1), lineWidth: 1))
        }
            .frame(width: 49, height: 12, alignment: .topLeading)
    }
        .padding(EdgeInsets(top: 6, leading: 30, bottom: 0, trailing: 30))
        .frame(width: 393, height: 48, alignment: .topLeading)
        .offset(x: 0, y: 0)
    VStack(alignment: .leading, spacing: 20) {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Good morning, Maya")
                    .font(.custom("Inter", size: 13).weight(.medium))
                    .foregroundColor(Color(red: 0.39, green: 0.45, blue: 0.55, opacity: 1))
                Text("Where to today?")
                    .font(.custom("Inter", size: 28).weight(.bold))
                    .foregroundColor(Color(red: 0.06, green: 0.09, blue: 0.16, opacity: 1))
            }
                .frame(width: 217, height: 53.8, alignment: .topLeading)
            HStack(alignment: .center, spacing: 0) {
                Text("MC")
                    .font(.custom("Inter", size: 15).weight(.semibold))
                    .foregroundColor(Color(red: 1, green: 1, blue: 1, opacity: 1))
            }
                .frame(width: 46, height: 46, alignment: .topLeading)
                .background(Color(red: 1, green: 0.6, blue: 0.38, opacity: 1))
                .clipShape(RoundedRectangle(cornerRadius: 23))
        }
            .frame(width: 353, height: 53.8, alignment: .topLeading)
        HStack(alignment: .center, spacing: 10) {
            HStack(alignment: .center, spacing: 10) {
                ZStack(alignment: .topLeading) {
                    // Vector: export as an image asset
                    Image("search")
                        .resizable()
                        .frame(width: 13.75, height: 13.75)
                        .overlay(RoundedRectangle(cornerRadius: 0).stroke(Color(red: 0.39, green: 0.45, blue: 0.55, opacity: 1), lineWidth: 2))
                        .offset(x: 3.33, y: 3.33)
                }
                    .frame(width: 20, height: 20, alignment: .topLeading)
                Text("Search trails, peaks, lakes")
                    .font(.custom("Inter", size: 15).weight(.regular))
                    .foregroundColor(Color(red: 0.39, green: 0.45, blue: 0.55, opacity: 1))
            }
                .frame(width: 214, height: 22.5, alignment: .topLeading)
            ZStack(alignment: .topLeading) {
                // Vector: export as an image asset
                Image("sliders")
                    .resizable()
                    .frame(width: 13.33, height: 12.5)
                    .overlay(RoundedRectangle(cornerRadius: 0).stroke(Color(red: 0.06, green: 0.09, blue: 0.16, opacity: 1), lineWidth: 2))
                    .offset(x: 3.33, y: 3.75)
            }
                .frame(width: 20, height: 20, alignment: .topLeading)
        }
            .padding(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
            .frame(width: 353, height: 50, alignment: .topLeading)
            .background(Color(red: 0.92, green: 0.93, blue: 0.95, opacity: 1))
            .clipShape(RoundedRectangle(cornerRadius: 14))
        HStack(alignment: .center, spacing: 8) {
            Chip()
            Chip(selected: .off)
            Chip(selected: .off)
            Chip(selected: .off)
        }
            .frame(width: 334, height: 36.2, alignment: .topLeading)
        HStack(alignment: .center, spacing: 8) {
            Text("Featured trail")
                .font(.custom("Inter", size: 17).weight(.semibold))
                .foregroundColor(Color(red: 0.06, green: 0.09, blue: 0.16, opacity: 1))
            Text("See all")
                .font(.custom("Inter", size: 13).weight(.medium))
                .foregroundColor(Color(red: 0.05, green: 0.49, blue: 0.4, opacity: 1))
        }
            .frame(width: 353, height: 22.1, alignment: .topLeading)
        TrailCard()
        HStack(alignment: .center, spacing: 8) {
            Text("Nearby")
                .font(.custom("Inter", size: 17).weight(.semibold))
                .foregroundColor(Color(red: 0.06, green: 0.09, blue: 0.16, opacity: 1))
            Text("Map view")
                .font(.custom("Inter", size: 13).weight(.medium))
                .foregroundColor(Color(red: 0.05, green: 0.49, blue: 0.4, opacity: 1))
        }
            .frame(width: 353, height: 22.1, alignment: .topLeading)
        TrailRow(details: "Lake Louise, AB  ·  7.4 km  ·  Moderate", title: "Lake Agnes Teahouse")
        TrailRow(details: "Banff, AB  ·  4.1 km  ·  Hard", title: "Sulphur Ridge Lookout")
    }
        .padding(EdgeInsets(top: 10, leading: 20, bottom: 0, trailing: 20))
        .frame(width: 393, height: 766.5, alignment: .topLeading)
        .offset(x: 0, y: 48)
    HStack(alignment: .center, spacing: 0) {
        VStack(alignment: .leading, spacing: 4) {
            ZStack(alignment: .topLeading) {
                // Vector: export as an image asset
                Image("compass")
                    .resizable()
                    .frame(width: 18, height: 18)
                    .overlay(RoundedRectangle(cornerRadius: 0).stroke(Color(red: 0.05, green: 0.49, blue: 0.4, opacity: 1), lineWidth: 2))
                    .offset(x: 3, y: 3)
            }
                .frame(width: 24, height: 24, alignment: .topLeading)
            Text("Explore")
                .font(.custom("Inter", size: 11).weight(.medium))
                .foregroundColor(Color(red: 0.05, green: 0.49, blue: 0.4, opacity: 1))
        }
            .frame(width: 72, height: 42.3, alignment: .topLeading)
        VStack(alignment: .leading, spacing: 4) {
            ZStack(alignment: .topLeading) {
                // Vector: export as an image asset
                Image("bookmark")
                    .resizable()
                    .frame(width: 11, height: 16.5)
                    .overlay(RoundedRectangle(cornerRadius: 0).stroke(Color(red: 0.39, green: 0.45, blue: 0.55, opacity: 1), lineWidth: 2))
                    .offset(x: 6.5, y: 4)
            }
                .frame(width: 24, height: 24, alignment: .topLeading)
            Text("Saved")
                .font(.custom("Inter", size: 11).weight(.medium))
                .foregroundColor(Color(red: 0.39, green: 0.45, blue: 0.55, opacity: 1))
        }
            .frame(width: 72, height: 42.3, alignment: .topLeading)
        VStack(alignment: .leading, spacing: 4) {
            ZStack(alignment: .topLeading) {
                // Vector: export as an image asset
                Image("activity")
                    .resizable()
                    .frame(width: 18, height: 14)
                    .overlay(RoundedRectangle(cornerRadius: 0).stroke(Color(red: 0.39, green: 0.45, blue: 0.55, opacity: 1), lineWidth: 2))
                    .offset(x: 3, y: 5)
            }
                .frame(width: 24, height: 24, alignment: .topLeading)
            Text("Activity")
                .font(.custom("Inter", size: 11).weight(.medium))
                .foregroundColor(Color(red: 0.39, green: 0.45, blue: 0.55, opacity: 1))
        }
            .frame(width: 72, height: 42.3, alignment: .topLeading)
        VStack(alignment: .leading, spacing: 4) {
            ZStack(alignment: .topLeading) {
                // Vector: export as an image asset
                Image("user")
                    .resizable()
                    .frame(width: 15, height: 16.5)
                    .overlay(RoundedRectangle(cornerRadius: 0).stroke(Color(red: 0.39, green: 0.45, blue: 0.55, opacity: 1), lineWidth: 2))
                    .offset(x: 4.5, y: 4)
            }
                .frame(width: 24, height: 24, alignment: .topLeading)
            Text("Profile")
                .font(.custom("Inter", size: 11).weight(.medium))
                .foregroundColor(Color(red: 0.39, green: 0.45, blue: 0.55, opacity: 1))
        }
            .frame(width: 72, height: 42.3, alignment: .topLeading)
        RoundedRectangle(cornerRadius: 3)
            .fill(Color(red: 0.06, green: 0.09, blue: 0.16, opacity: 1))
            .frame(width: 134, height: 5)
    }
        .padding(EdgeInsets(top: 10, leading: 0, bottom: 0, trailing: 0))
        .frame(width: 393, height: 86, alignment: .topLeading)
        .background(Color(red: 1, green: 1, blue: 1, opacity: 0.86))
        .overlay(RoundedRectangle(cornerRadius: 0).stroke(Color(red: 0.89, green: 0.91, blue: 0.94, opacity: 1), lineWidth: 1))
        .offset(x: 0, y: 766)
}
    .frame(width: 393, height: 852, alignment: .topLeading)
    .background(Color(red: 0.96, green: 0.96, blue: 0.97, opacity: 1))

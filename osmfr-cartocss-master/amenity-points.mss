.poi_icon {
  [pixels>1000][feature = 'power_plant']
  {
    point-file: url('symbols/fr/electricity.svg');
    point-placement: interior;
    text-dy: 12;
    text-size: 10;
    text-name: "[nom]";
    text-halo-radius: 1;
    text-face-name: @book-fonts;
    text-wrap-width: 80;
  }

  [zoom >= 11] {
    [feature = 'natural_peak'] {
      point-file: url('symbols/peak.svg');
      point-placement: interior;
    }

    [feature = 'natural_mountain_pass'],
    [feature = 'natural_saddle'] {
      point-file: url('symbols/mountain_pass.svg');
      point-placement: interior;
    }

    [feature = 'natural_volcano'] {
      point-file: url('symbols/volcano.png');
      point-placement: interior;
    }

  	[feature = 'aeroway_international'],
	  [feature = 'aeroway_continental'],
	  [feature = 'aeroway_military'],
    [feature = 'aeroway_airfield'],
    [feature = 'aeroway_aerodrome'],
	  [feature = 'aeroway_airport'] {
      text-dy: -12;
      text-size: 9;
      text-name: "[nom]";
      text-fill: #6692da;
      text-halo-radius: 1;
      text-avoid-edges: true;
      text-face-name: @bold-fonts;
      text-wrap-width: 40;
      [feature = 'aeroway_airfield'],
      [feature = 'aeroway_military'] {
        text-fill: black;
        text-face-name: @book-fonts;
      }
      [zoom>=13] { text-size: 11; }
      [zoom >= 14] {
        text-dy: 0;
        [zoom>=16] { text-size: 20; }
        text-size: 16;
        text-name: "[nom]";
        text-fill: grey;
        text-halo-radius: 1;
        text-avoid-edges: true;
        text-face-name: @oblique-fonts;
      }

      point-file: url('symbols/airport2.svg');
  	  [feature = 'aeroway_aerodrome'] {
    		point-file: url('symbols/aerodrome.svg');
    		[zoom>=12] {
    			text-size: 9;
    			text-face-name: @oblique-fonts;
          [feature = 'aeroway_airfield'],
          [feature = 'aeroway_military'] {
            text-fill: black;
            text-face-name: @book-fonts;
          }
    		}
  	  }
      [feature = 'aeroway_airfield'],
      [feature = 'aeroway_military'] {
        point-file: url('symbols/airport-red.svg');
      }
	  }
  }

  [zoom >= 14] {
      [feature = 'natural_spring'] {
      point-file: url('symbols/spring.png');
      point-placement: interior;
    }

    [feature = 'barrier_toll_booth'] {
      point-file: url('symbols/lift_gate.svg');
      point-placement: interior;
    }
  }

  [zoom >= 15] {
    [feature = 'power_generator'][power_source = 'wind']
    {
      point-placement: interior;
      point-file: url('symbols/power_wind.png');
    }

    [feature = 'natural_cave_entrance'] {
      point-file: url('symbols/poi_cave.p.16.png');
      point-placement: interior;
    }

    [feature = 'manmade_lighthouse'] {
      point-file: url('symbols/lighthouse.p.20.png');
      point-placement: interior;
    }

    [feature = 'manmade_windmill'] {
      point-file: url('symbols/windmill.png');
      point-placement: interior;
    }

    [feature = 'manmade_mast'] {
      point-file: url('symbols/communications.p.20.png');
      point-placement: interior;
    }

    [feature = 'railway_level_crossing'],
    [feature = 'railway_crossing'] {
      point-file: url('symbols/level_crossing2.svg');
      point-transform: "scale(0.5)";
      point-placement: interior;
    }
  }

  [zoom >= 16] {
    [feature = 'aeroway_helipad'] {
      point-file: url('symbols/helipad.svg');
      text-name: "[nom]";
      text-size: 9;
      text-fill: #6692da;
      text-dy: -12;
      text-face-name: @bold-fonts;
      text-halo-radius: 1;
      text-avoid-edges: true;
      text-wrap-width: 50;
    }

    [feature = 'highway_mini_roundabout'] {
      point-file: url('symbols/mini_round.png');
      point-placement: interior;
    }

    [feature = 'barrier_lift_gate'] {
      point-file: url('symbols/lift_gate.svg');
      point-placement: interior;
    }
  }

  [zoom >= 17] {
    [feature = 'railway_buffer_stop'] {
      point-file: url('symbols/buffer_stop.svg');
      [zoom=17] { point-transform: "scale(0.5)"; }
    }
  }
}

#poi-icon-more [zoom >= 14] {
  [feature = 'amenity_hospital'],
  [feature = 'amenity_clinic'] {
    [zoom >= 15],
    [pixels >= @poi_min_pixels] {
      marker-file: url('symbols/fr/hopital.svg');
      marker-fill: @health-color;
      point-placement: interior;
    }
  }
  [feature = 'amenity_post_office'][zoom >= 16][operator='La Poste'],
  [feature = 'amenity_post_office'][zoom >= 16][ref_laposte!=''] {
    [poi_type =~ '(post_annex|post_partner)'] {
      point-file: url('symbols/fr/LaPoste3-gris.png');
    }
    point-file: url('symbols/fr/LaPoste3.png');
    point-transform: "scale(0.5)";
    // point-file: url('symbols/post_office_yellow.svg');
    point-placement: interior;
    [indoor='yes'] { point-opacity: 0.5; }
  }

  [feature = 'amenity_post_office'][zoom >= 16][operator='bpost'] {
    [indoor='yes'] { point-opacity: 0.5; }
    point-file: url('symbols/fr/logo_bpost.png');
    point-placement: interior;
    point-transform: "scale(0.5)";
    [indoor='yes'] { point-opacity: 0.5; }
  }

  [feature = 'amenity_post_office'][zoom >= 16] {
    point-file: url('symbols/post_office.svg');
    point-placement: interior;
    [indoor='yes'] { point-opacity: 0.5; }
  }

  [feature = 'amenity_shelter'][poi_type!='public_transport'][zoom >= 16] {
    point-file: url('symbols/shelter2.svg');
    point-placement: interior;
  }

  [feature = 'amenity_atm'][zoom >=17] {
    marker-file: url('symbols/2021/amenity/atm.svg');
    marker-fill: @brown-poi;
    marker-placement: interior;
    [indoor='yes'] { point-opacity: 0.5; }
  }

  [feature = 'amenity_bank'][zoom >= 17] {
    marker-file: url('symbols/2021/amenity/bank.svg');
    marker-fill: @brown-poi;
    marker-placement: interior;
    [indoor='yes'] { point-opacity: 0.5; }
  }

  [feature = 'amenity_bar'][zoom >=17] {
    point-file: url('symbols/bar.svg');
    point-placement: interior;
    [indoor='yes'] { point-opacity: 0.5; }
  }

  [feature = 'amenity_bicycle_rental'][zoom >= 17] {
    [network=~'^Vélib.?'] {
      point-file: url('symbols/fr/Velib.svg');
      point-transform: "scale(2)";
    }
    [network=~"^Vélo.v"] {
      point-file: url('symbols/fr/velov.png');
      point-transform: "scale(0.5)";
    }
    [network=~"^V.Lille"] {
      point-file: url('symbols/fr/v-lille.png');
      point-transform: "scale(0.33)";
    }
    [network=~"^V.EOL"] {
      point-file: url('symbols/fr/veol-caen.png');
      point-transform: "scale(0.75)";
    }
    point-file: url('symbols/rental_bicycle.svg');
    point-placement: interior;
  }

  [feature = 'amenity_car_rental'][zoom >= 17] {
    point-file: url('symbols/rental_car.svg');
    point-placement: interior;
  }

  [feature = 'amenity_taxi'][zoom >= 17] {
    point-file: url('symbols/taxi_rank.svg');
    point-placement: interior;
    [indoor='yes'] { point-opacity: 0.5; }
  }

  [feature = 'amenity_cafe'][zoom >=17] {
    point-file: url('symbols/cafe.svg');
    point-placement: interior;
    [indoor='yes'] { point-opacity: 0.5; }
  }

  [feature = 'amenity_car_sharing'][zoom >= 16] {
    point-file: url('symbols/car_share.svg');
    point-placement: interior;
    [indoor='yes'] { point-opacity: 0.5; }
  }

  [feature = 'amenity_chalet'][zoom >= 17] {
    point-file: url('symbols/chalet.svg');
    point-placement: interior;
  }

  [feature = 'amenity_cinema'][zoom >= 17] {
    marker-file: url('symbols/2016/cinema.16.svg');
    marker-fill: @brown-poi;
    marker-placement: interior;
    marker-clip: false;
  }

  [feature = 'amenity_fire_station'] {
    [zoom >= 16],
    [pixels >= @poi_min_pixels] {
      marker-file: url('symbols/2016/firestation.16.svg');
      marker-fill: @brown-poi;
      marker-placement: interior;
      marker-clip: false;
    }
  }

  [feature = 'amenity_fountain'][zoom >= 18] {
    marker-file: url('symbols/2016/fountain-14.svg');
    marker-placement: interior;
    marker-fill: #07d;
    marker-clip: false;
  }

  [feature = 'amenity_fuel'][zoom >= 17] {
    [lpg='yes'] { point-file: url('symbols/fuel_gpl.svg'); }
    point-file: url('symbols/fuel.svg');
    point-placement: interior;
  }

  [feature = 'amenity_embassy'][zoom >= 17] {
    point-file: url('symbols/embassy.svg');
  }

  [feature = 'amenity_consulate'][zoom >= 17] {
    point-file: url('symbols/embassy.svg');
  }


  [feature = 'amenity_townhall'] {
    [zoom >= 13],
    [pixels >= @poi_min_pixels] {
      marker-file: url('symbols/town_hall.16.svg');
      [zoom <=14] { marker-transform: "scale(0.66)"; }
      marker-placement: interior;
      marker-clip: false;
      marker-fill: #666;
    }
  }

  [feature = 'amenity_library'] {
    [zoom >= 17],
    [pixels >= @poi_min_pixels] {
      marker-file: url('symbols/2016/library.14.svg');
      marker-fill: @brown-poi;
      marker-placement: interior;
      marker-clip: false;
    }
  }

  [feature = 'amenity_courthouse'] {
    [zoom > 16],
    [pixels >= @poi_min_pixels] {
      marker-file: url('symbols/2016/courthouse-16.svg');
      marker-fill: @brown-poi;
      marker-placement: interior;
      marker-clip: false;
    }
  }

  [feature = 'amenity_doctors'][zoom > 17] {
    marker-file: url('symbols/doctors.16.svg');
    marker-fill: @health-color;
    marker-placement: interior;
    marker-clip: false;
  }

  [feature = 'amenity_dentist'][zoom > 17] {
    marker-file: url('symbols/2016/dentist.16.svg');
    marker-fill: @health-color;
    marker-placement: interior;
    marker-clip: false;
  }

  [feature = 'amenity_veterinary'][zoom > 17] {
    marker-file: url('symbols/2016/veterinary-14.svg');
    marker-fill: @health-color;
    marker-placement: interior;
    marker-clip: false;
  }

  [feature = 'amenity_parking'][pixels> @poi_min_pixels * 4],
  [feature = 'amenity_parking'][zoom >= 15][parking='multi-storey'],
  [feature = 'amenity_parking'][zoom >= 16][name != ''],
  [feature = 'amenity_parking'][zoom >= 17] {
    point-file: url('symbols/parking.svg');
    point-placement: interior;
    [access != ''][access != 'public'][access != 'yes'] {
      point-file: url('symbols/parking_private2.svg');
    }
  }

  [feature = 'amenity_bicycle_parking'][zoom >= 18] {
    point-file: url('symbols/parking_bicycle.svg');
    point-placement: interior;
    [indoor='yes'] { point-opacity: 0.5; }
  }

  [feature = 'amenity_pharmacy'][zoom >= 16] {
    point-file: url('symbols/fr/pharmacie.svg');
    point-placement: interior;
    [indoor='yes'] { point-opacity: 0.5; }
  }

  [feature = 'amenity_place_of_worship'] {
    [zoom >= 16],
    [pixels >= @poi_min_pixels] {
      [indoor='yes'] { point-opacity: 0.5; }
      marker-file: url('symbols/place_of_worship3.p.16.png');
      marker-placement: interior;
      marker-clip: false;
      [religion = 'christian'] {
        marker-file: url('symbols/2016/christian.16.svg');
      }
      [religion = 'muslim'] {
        marker-file: url('symbols/2016/muslim.16.svg');
      }
      [religion = 'sikh'] {
        marker-file: url('symbols/2016/sikhist.16.svg');
      }
      [religion = 'jewish'] {
        marker-file: url('symbols/2016/jewish.16.svg');
      }
      [religion = 'buddhist'] {
        marker-file: url('symbols/2016/buddhist.16.svg');
      }
      // monument classé...
      [heritage!=''] {
        marker-fill: @brown-poi;
      }
    }
  }

  [feature = 'amenity_marketplace'] {
    marker-file: url('symbols/marketplace.svg');
  }

  [feature = 'amenity_police'] {
    [zoom >= 16],
    [pixels >= @poi_min_pixels] {
      marker-file: url('symbols/police.16.svg');
      marker-fill: @brown-poi;
      marker-placement: interior;
      marker-clip: false;
      [indoor='yes'] { marker-opacity: 0.5; }
    }
  }

  [feature = 'amenity_post_box'][zoom >= 17] {
    [operator='La Poste'] { point-file: url('symbols/post_box_yellow.svg'); }
    point-file: url('symbols/post_box.svg');
    point-placement: interior;
    [indoor='yes'] { point-opacity: 0.5; }
  }

  [feature = 'amenity_pub'][zoom >= 17] {
    point-file: url('symbols/pub.svg');
    point-placement: interior;
    [indoor='yes'] { point-opacity: 0.5; }
  }

  [feature = 'amenity_biergarten'][zoom >= 16] {
    point-file: url('symbols/biergarten.p.16.png');
    point-placement: interior;
    [indoor='yes'] { point-opacity: 0.5; }
  }

  [feature = 'amenity_recycling'][poi_type='centre'][zoom >= 16],
  [feature = 'amenity_recycling'][pixels >= @poi_min_pixels],
  [feature = 'amenity_recycling'][zoom >= 17] {
    point-file: url('symbols/recycling.svg');
    point-placement: interior;
    [poi_type='centre'] { point-file: url('symbols/recycling_centre.svg'); }
    [indoor='yes'] { point-opacity: 0.5; }
  }

  [feature = 'amenity_restaurant'][zoom >= 17] {
    point-file: url('symbols/restaurant.svg');
    point-placement: interior;
    [indoor='yes'] { point-opacity: 0.5; }
  }

  [feature = 'amenity_fast_food'][zoom >= 17] {
    point-file: url('symbols/fastfood.svg');
    point-placement: interior;
    [indoor='yes'] { point-opacity: 0.5; }
  }

  [feature = 'amenity_telephone'][zoom >= 17] {
    point-file: url('symbols/telephone.svg');
    point-placement: interior;
    [indoor='yes'] { point-opacity: 0.5; }
  }

  [feature = 'emergency_phone'][zoom >= 17],
  [feature = 'amenity_emergency_phone'][zoom >= 17] {
    point-file: url('symbols/emergency_phone.svg');
    point-placement: interior;
    [indoor='yes'] { point-opacity: 0.5; }
  }

  [feature = 'amenity_theatre'] {
    [zoom >= 16],
    [pixels >= @poi_min_pixels] {
      point-file: url('symbols/theatre.svg');
      point-placement: interior;
      [indoor='yes'] { point-opacity: 0.5; }
    }
  }

  [feature = 'amenity_toilets'][zoom >= 17] {
    point-file: url('symbols/toilets.svg');
    point-placement: interior;
    [indoor='yes'] { point-opacity: 0.5; }
  }

  [feature = 'amenity_drinking_water'][zoom >= 17] {
    point-file: url('symbols/food_drinkingtap.svg');
    point-placement: interior;
    [indoor='yes'] { point-opacity: 0.5; }
  }

  [feature = 'amenity_prison'] {
    [zoom >= 16],
    [pixels >= @poi_min_pixels] {
      point-file: url('symbols/prison.svg');
      point-placement: interior;
    }
  }

  [feature = 'amenity_charging_station'][zoom >= 17]   {
    marker-file: url('symbols/fr/IRVE_blue.svg');
    marker-transform: "scale(0.033)";
    marker-clip: false;
    marker-placement: interior;
  }

  [feature = 'amenity_bench'][zoom >= 19] {
    marker-file: url('symbols/2021/amenity/bench.svg');
    marker-placement: interior;
    marker-fill: #666;
    [indoor='yes'] { marker-opacity: 0.5; }
  }

  [feature = 'emergency_aed'][zoom >= 17],
  [feature = 'emergency_defibrillator)'][zoom >= 17] {
    point-file: url('symbols/fr/aed2.svg');
    point-placement: interior;
    [indoor='yes'] { point-opacity: 0.5; }
  }


  [feature = 'tourism_alpine_hut'][zoom >= 13] {
    point-file: url('symbols/alpinehut.svg');
    point-placement: interior;
  }

  [feature = 'tourism_camp_site'] {
    [zoom >= 16],
    [pixels >= @poi_min_pixels] {
      point-file: url('symbols/camping.svg');
      point-placement: interior;
    }
  }

  [feature = 'tourism_caravan_site'] {
    [zoom >= 16],
    [pixels >= @poi_min_pixels] {
      point-file: url('symbols/caravan_park.svg');
      point-placement: interior;
    }
  }

  [feature = 'tourism_guest_house'][zoom >= 17] {
    point-file: url('symbols/guest_house.svg');
    point-placement: interior;
  }

  [feature = 'tourism_bed_and_breakfast'][zoom >= 17] {
    point-file: url('symbols/bandb.svg');
    point-placement: interior;
  }

  [feature = 'tourism_hostel'][zoom >= 17] {
    point-file: url('symbols/hostel.svg');
    point-placement: interior;
  }

  [feature = 'tourism_hotel'] {
    [zoom >= 17],
    [pixels >= @poi_min_pixels] {
      point-file: url('symbols/hotel2.svg');
      point-placement: interior;
    }
  }

  [feature = 'tourism_motel'][zoom >= 17] {
    point-file: url('symbols/motel.svg');
    point-placement: interior;
  }

  [feature = 'tourism_information'][poi_type!='trail_blaze'][zoom >= 16] {
    point-file: url('symbols/information.svg');
    point-placement: interior;
    [indoor='yes'] { point-opacity: 0.5; }
    [poi_type='guidepost'] {
      point-file: url('symbols/guidepost.svg');
    }
  }

  [feature = 'tourism_museum'] {
    [zoom >= 17],
    [pixels >= @poi_min_pixels] {
      point-file: url('symbols/museum.svg');
      point-placement: interior;
      [indoor='yes'] { point-opacity: 0.5; }
    }
  }

  [feature = 'tourism_artwork'] {
    [zoom >= 18],
    [pixels >= @poi_min_pixels] {
      marker-file: url('symbols/2021/historic/statue.svg');
      marker-fill: @brown-poi;
      marker-placement: interior;
      [indoor='yes'] { marker-opacity: 0.5; }
    }
  }


  [feature = 'tourism_zoo'][zoom >= 14] {
    point-file: url('symbols/zoo.svg');
    point-placement: interior;
  }

  [feature = 'tourism_viewpoint'][zoom >= 16] {
    marker-file: url('symbols/2016/viewpoint.16.svg');
    marker-fill: @brown-poi;
    marker-placement: interior;
    marker-clip: false;
  }

  [feature = 'manmade_windmill'][zoom >= 16] {
    marker-file: url('symbols/2016/windmill.16.svg');
    marker-fill: @brown-poi;
    marker-placement: interior;
    marker-clip: false;
  }

  [feature = 'manmade_lighthouse'][zoom >= 15] {
    marker-file: url('symbols/2016/lighthouse.16.svg');
    marker-fill: @brown-poi;
    marker-placement: interior;
    marker-clip: false;
  }

  [feature = 'military_bunker'][zoom >= 17] {
    marker-file: url('symbols/bunker.svg');
    marker-fill: @brown-poi;
  }

  [feature = 'historic_memorial'][zoom >= 17] {
    marker-file: url('symbols/2016/tourist_memorial.16.svg');
    marker-fill: @brown-poi;
    marker-placement: interior;
    marker-clip: false;
    [indoor='yes'] { marker-opacity: 0.5; }
  }

  [feature = 'historic_tomb'][zoom >= 18],
  [feature = 'historic_grave'][zoom >= 18] {
    marker-file: url('symbols/2021/historic/memorial.svg');
    marker-fill: @brown-poi;
    marker-placement: interior;
    marker-clip: false;
    [indoor='yes'] { marker-opacity: 0.5; }
  }

  [feature = 'historic_archaeological_site'][zoom >= 16] {
    marker-file: url('symbols/2016/archaeological_site.16.svg');
    marker-fill: @brown-poi;
    marker-placement: interior;
    marker-clip: false;
  }

  [feature = 'historic_castle'][zoom >= 15],
  [feature = 'historic_manor'][zoom >= 15] {
    point-file: url('symbols/castle2.svg');
    point-placement: interior;
  }

  [heritage = '1'] {
    [zoom >= 14],
    [pixels >= @poi_min_pixels] {
      point-file: url('symbols/view_point.svg');
      point-transform: "scale(0.75)";
      point-placement: interior;
    }
  }

  [zoom >= 15][feature = 'waterway_lock']::lock,
  [zoom >= 15][lock = 'yes']::lock {
      point-file: url('symbols/lock_gate.svg');
      point-placement: interior;
  }

  ::mall [zoom >= 16],
  ::mall [pixels >= @poi_min_pixels] {
    [feature = 'shop_supermarket'] {
      marker-file: url('symbols/supermarket.svg');
      marker-clip: false;
      marker-placement: interior;
      [organic='only'] { marker-file: url('symbols/supermarket-organic.svg');}
      [level<0] { marker-opacity: 0.5; }
    }

    [feature = 'shop_mall'] {
      marker-file: url('symbols/shopping.svg');
      marker-fill: @shop-icon;
      marker-clip: false;
      marker-placement: interior;
      [level<0] { marker-opacity: 0.5; }
    }

    [feature = 'shop_department_store'] {
      marker-file: url('symbols/2021/shop/department_store.svg');
      marker-fill: @shop-icon;
      marker-clip: false;
      marker-placement: interior;
      [level<0] { marker-opacity: 0.5; }
    }
  }

  ::shop {
    [zoom >= 17],
    [pixels >= @poi_min_pixels] {

      // icone multicolores donc en point-file...
      [feature = 'shop_butcher'] {
        point-file: url('symbols/butcher2.svg');
        [level<0] { point-opacity: 0.5; }
      }

      [feature = 'shop_convenience'] {
        point-file: url('symbols/convenience.svg');
        [organic='only'] { point-file: url('symbols/convenience-organic.svg');}
        [level<0] { point-opacity: 0.5; }
      }
      [feature = 'amenity_vehicle_inspection'] {
        point-file: url('symbols/vehicle_inspection.svg');
        [level<0] { point-opacity: 0.5; }
      }

      [feature = 'amenity_ice_cream'] { marker-fill: @shop-icon; marker-file: url('symbols/2016/ice-cream-14.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'amenity_car_wash'] { marker-fill: @shop-icon; marker-file: url('symbols/2016/car_wash-14.svg'); [level<0] {marker-opacity: 0.5;}}


      [feature = 'shop_bakery'] { marker-fill: @shop-icon; marker-file: url('symbols/shop_bakery.16.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_beauty'] { marker-fill: @shop-icon; marker-file: url('symbols/2016/beauty-14.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_fishmonger'],[feature = 'shop_seafood'] { marker-fill: @shop-icon; marker-file: url('symbols/2016/seafood-14.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_beverages'] { marker-fill: @shop-icon; marker-file: url('symbols/2016/beverages-14.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_alcohol'] { marker-fill: @shop-icon; marker-file: url('symbols/alcohol.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_greengrocer'] { marker-fill: @shop-icon; marker-file: url('symbols/greengrocer.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_confectionery'] { marker-fill: @shop-icon; marker-file: url('symbols/confectionery.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_chocolate'] { marker-fill: @shop-icon; marker-file: url('symbols/confectionery.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_clothes'],[feature = 'shop_fashion'],[feature = 'shop_boutique'] { marker-fill: @shop-icon; marker-file: url('symbols/2016/shop_clothes.16.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_bag'] { marker-fill: @shop-icon; marker-file: url('symbols/2016/bag-14.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_doityourself'] { marker-fill: @shop-icon; marker-file: url('symbols/diy.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_florist'] { marker-fill: @shop-icon; marker-file: url('symbols/2016/florist.16.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_photo'],[feature = 'shop_photo_studio'] { marker-fill: @shop-icon; marker-file: url('symbols/2016/photo-14.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_garden_centre'] { marker-fill: @shop-icon; marker-file: url('symbols/2016/garden_centre-14.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_hairdresser'] { marker-fill: @shop-icon; marker-file: url('symbols/2016/shop_hairdresser.16.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_optician'] {   marker-fill: @shop-icon; marker-file: url('symbols/2016/shop_optician.16.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_toys'] { marker-fill: @shop-icon; marker-file: url('symbols/2016/toys-14.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_computer'] { marker-fill: @shop-icon; marker-file: url('symbols/2016/computer-14.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_car'] { marker-fill: @shop-icon; marker-file: url('symbols/shop_car.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_car_repair'] { marker-fill: @shop-icon; marker-file: url('symbols/car_repair.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_car_parts'] { marker-fill: @shop-icon; marker-file: url('symbols/2016/car_parts-14.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_bicycle'] { marker-fill: @shop-icon; marker-file: url('symbols/2016/shop_bicycle.16.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_copyshop'] { marker-fill: @shop-icon; marker-file: url('symbols/2016/copyshop-14.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_hifi'] { marker-fill: @shop-icon; marker-file: url('symbols/2016/hifi-14.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_travel_agency'] { marker-fill: @shop-icon; marker-file: url('symbols/travel_agency.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_jewelry'] { marker-fill: @shop-icon; marker-file: url('symbols/2016/shop_jewelry.16.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_shoes'] { marker-fill: @shop-icon; marker-file: url('symbols/2016/shop_shoes.16.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_laundry'],[feature = 'shop_dry_cleaning)'] { marker-fill: @shop-icon; marker-file: url('symbols/2016/laundry-14.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_mobile_phone'] { marker-fill: @shop-icon; marker-file: url('symbols/2016/shop_mobile_phone.16.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_motorcycle'] { marker-fill: @shop-icon; marker-file: url('symbols/motorcycle.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_musical_instrument'] { marker-fill: @shop-icon; marker-file: url('symbols/2016/musical_instrument-14.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_furniture'] { marker-fill: @shop-icon; marker-file: url('symbols/furniture.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_perfumery'] { marker-fill: @shop-icon; marker-file: url('symbols/2016/perfumery-14.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_sports'] { marker-fill: @shop-icon; marker-file: url('symbols/2016/sports-14.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_ice_cream'] { marker-fill: @shop-icon; marker-file: url('symbols/2016/ice-cream-14.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_electronics'] { marker-fill: @shop-icon; marker-file: url('symbols/2016/shop_electronics.16.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_tyres'] { marker-fill: @shop-icon; marker-file: url('symbols/tyres.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_video_games'] { marker-fill: @shop-icon; marker-file: url('symbols/video_games.svg'); [level<0] {marker-opacity: 0.5;}}

      [feature = 'shop_bed'] { marker-fill: @shop-icon; marker-file: url('symbols/2021/shop/bed.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_books'] { marker-fill: @shop-icon; marker-file: url('symbols/2021/amenity/library.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_coffee'] { marker-fill: @shop-icon; marker-file: url('symbols/2021/shop/coffee.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_carpet'] { marker-fill: @shop-icon; marker-file: url('symbols/2021/shop/carpet.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_charity'] { marker-fill: @shop-icon; marker-file: url('symbols/2021/shop/charity.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_chemist'] { marker-fill: @shop-icon; marker-file: url('symbols/2021/shop/chemist.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_dairy'] { marker-fill: @shop-icon; marker-file: url('symbols/2021/shop/dairy.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_deli'] { marker-fill: @shop-icon; marker-file: url('symbols/2021/shop/deli.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_fabric'] { marker-fill: @shop-icon; marker-file: url('symbols/2021/shop/fabric.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_gift'] { marker-fill: @shop-icon; marker-file: url('symbols/2021/shop/gift.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_houseware'] { marker-fill: @shop-icon; marker-file: url('symbols/2021/shop/houseware.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_interior_decoration'] { marker-fill: @shop-icon; marker-file: url('symbols/2021/shop/interior_decoration.svg'); marker-fill: @shop-icon; [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_medical_supply'] { marker-fill: @shop-icon; marker-file: url('symbols/2021/shop/medical_supply.svg'); marker-fill: @shop-icon; [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_music'] { marker-fill: @shop-icon; marker-file: url('symbols/2021/shop/music.svg'); marker-fill: @shop-icon; [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_newsagent'] { marker-fill: @shop-icon; marker-file: url('symbols/2021/shop/newsagent.svg'); marker-fill: @shop-icon; [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_outdoor'] { marker-fill: @shop-icon; marker-file: url('symbols/2021/shop/outdoor.svg'); marker-fill: @shop-icon; [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_paint'] { marker-fill: @shop-icon; marker-file: url('symbols/2021/shop/paint.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_pet'] { marker-fill: @shop-icon; marker-file: url('symbols/2021/shop/pet.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_second_hand'] { marker-fill: @shop-icon; marker-file: url('symbols/2021/shop/second_hand.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_stationery'] { marker-fill: @shop-icon; marker-file: url('symbols/2021/shop/stationery.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_tea'] { marker-fill: @shop-icon; marker-file: url('symbols/2021/shop/tea.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_ticket'] { marker-fill: @shop-icon; marker-file: url('symbols/2021/shop/ticket.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_tobacco'] { marker-fill: @shop-icon; marker-file: url('symbols/2021/shop/tobacco.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_trade'] { marker-fill: @shop-icon; marker-file: url('symbols/2021/shop/trade.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_video'] { marker-fill: @shop-icon; marker-file: url('symbols/2021/shop/video.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_variety_store'] { marker-fill: @shop-icon; marker-file: url('symbols/2021/shop/variety_store.svg'); [level<0] {marker-opacity: 0.5;}}

      [feature = 'shop_frozen_food'] { marker-fill: @shop-icon; marker-file: url('symbols/fr/shop_frozen_food.svg'); [level<0] {marker-opacity: 0.5;}}
      [feature = 'shop_funeral_directors'] { marker-fill: @shop-icon; marker-file: url('symbols/2016/tourist_memorial.16.svg'); [level<0] {marker-opacity: 0.5;}}

    }
  }

  [feature = 'healthcare_optometrist'][zoom >= 17] {
    marker-fill: @health-color;
    marker-file: url('symbols/2016/shop_optician.16.svg');
  }

  [feature = 'healthcare_physiotherapist'][zoom >= 17] {
    marker-fill: @health-color;
    marker-file: url('symbols/2021/shop/massage.svg');
  }

  [feature = 'healthcare_podiatrist'][zoom >= 17] {
    marker-fill: @health-color;
    marker-file: url('symbols/2021/shop/shoes.svg');
  }

  ::default {
    [pixels >= @poi_min_pixels],
    [zoom >= 17] {
      [shop != ''] {
        // marque par défaut
        marker-file: url('symbols/disque.svg');
        marker-fill: @shop-icon;
        marker-line-width: 0;
        [shop = 'vacant'] {
          marker-opacity: 0.33;
          marker-line-width: 0.5;
        }
        [level<0] {marker-opacity: 0.5;}
      }

      [office != ''],
      [craft != ''] {
        marker-file: url('symbols/disque.svg');
        marker-fill: @office;
        marker-line-width: 0;
        marker-clip: false;
        [office = 'vacant'], [craft = 'vacant'] {
          marker-opacity: 0.33;
          marker-line-width: 0.5;
        }
        [level<0] {marker-opacity: 0.5;}
      }

      [healthcare != ''] {
        marker-fill:  @health-color;
        marker-line-width: 0;
        marker-clip: false;
        marker-file: url('symbols/disque.svg');
        [level<0] {marker-opacity: 0.5;}
      }
    }
  }

  ::leisure {
    [feature = 'leisure_playground'] {
      [pixels >= @poi_min_pixels],
      [zoom >= 17] {
        point-file: url('symbols/playground.svg');
        point-placement: interior;
      }
    }

    [feature = 'leisure_water_park'] {
      [zoom >= 16],
      [pixels >= @poi_min_pixels] {
        marker-file: url('symbols/2016/water_park.16.svg');
        marker-fill: @brown-poi;
        marker-placement: interior;
        marker-clip: false;
      }
    }

    [feature = 'leisure_outdoor_seating'] {
      [pixels >= @poi_min_pixels],
      [zoom >= 18] {
        marker-file: url('symbols/2021/leisure/outdoor_seating.svg');
        marker-placement: interior;
        marker-fill: @leisure-color;
      }
    }

    [feature = 'amenity_picnic_site'][zoom >= 16],
    [feature = 'amenity_picnic_site'][pixels >= @poi_min_pixels],
    [feature = 'leisure_picnic_table'][zoom >= 18] {
      point-file: url('symbols/picnic.svg');
      point-placement: interior;
    }

    [feature = 'leisure_slipway'][zoom >= 17] {
      point-file: url('symbols/transport_slipway.p.20.png');
      point-placement: interior;
    }

    [feature = 'leisure_golf_course'][zoom >= 14][zoom < 16],
    [feature = 'leisure_golf_course'][pixels >= @poi_min_pixels][zoom < 16] {
      marker-file: url('symbols/fr/golf-maki.svg');
      marker-fill: #040; // un peu de vert...
      marker-transform: "scale(0.15)";
      marker-placement: interior;
      marker-clip: false;
    }

    [feature = 'leisure_fitness_station'][zoom >= 17] {
      marker-file: url('symbols/2016/sports-14.svg');
      marker-fill: @leisure-color;
    }

  }

  ::other [zoom >= 16] {
    [feature = 'barrier_lift_gate'] {
      point-file: url('symbols/lift_gate.svg');
      point-placement: interior;
    }

    [feature = 'highway_gate'],
    [feature = 'barrier_gate'] {
      point-file: url('symbols/gate2.png');
      point-placement: interior;
    }

    [feature = 'highway_ford'] {
      point-file: url('symbols/transport_ford.svg');
      point-placement: interior;
    }

    [feature = 'highway_street_lamp'][zoom>=19] {
        marker-file: url('symbols/disque.svg');
        marker-transform: "scale(1.5)";
        marker-fill: grey;
        marker-line-width: 2.5;
        marker-line-color: #ffc;
    }

    [feature = 'barrier_bollard'],
    [feature = 'barrier_block'] {
      point-file: url('symbols/bollard.png');
      point-placement: interior;
    }

    [feature = 'manmade_water_tower'] {
      point-file: url('symbols/fr/water_tower.svg');
      point-placement: interior;
    }

    [feature = 'highway_traffic_signals'][zoom >= 17] {
      point-file: url('symbols/traffic_lights.svg');
      point-placement: interior;
    }

    [feature = 'manmade_mast'][zoom >= 17] {
      point-file: url('symbols/tower_communications.svg');
      point-placement: interior;
    }

    [feature = 'amenity_waste_disposal'][zoom >= 18] {
      marker-file: url('symbols/2021/amenity/waste_disposal.svg');
      marker-fill: #666;
    }

    [feature = 'amenity_waste_basket'][zoom >= 19] {
      marker-file: url('symbols/2021/amenity/waste_basket.svg');
      marker-fill: #666;
    }
  }
}

#entrance [zoom >= 17] {
  marker-fill: grey;
  marker-width: 3;
  marker-line-width: 0;
  [entrance='main'] { text-fill: black; marker-width: 4;}
  [entrance='emergency'] { marker-fill: #080; text-fill: #080; } // sorties de secours en vert foncé
  [ref!=''][nom!=''] { text-name: [nom]+" / "+[ref]; }
  [nom!=''] { text-name: [nom]; }
  text-name: "[ref]";
  text-fill: grey;
  text-face-name: @book-fonts;
  text-halo-radius: 1;
  text-avoid-edges: true;
  text-size: 9;
  text-dy: -4;
  text-wrap-width: 30;
  [indoor='yes'],[level<0] {
    marker-opacity: 0.5;
    text-opacity: 0.5;
  }
}

#poi-text-lz [zoom >= 12]
{

  // zoom 12

  [place = 'island']::place {
    [zoom >= 17] { text-name: "[name]"; }
    text-name: "[nom]";
    text-fill: #000;
    text-size: 9;
    text-dy: 6;
    text-face-name: @oblique-fonts;
    text-halo-radius: 1;
    text-avoid-edges: true;
    // variation de la texte du texte en fonction de la surface du polygone
    [pixels>20] {
      text-size: 12;
    }
    [pixels>100] {
      text-size: 14;
    }
  }

  [aeroway = 'danger_area']::aero {
    [zoom >= 17] { text-name: "[name]"; }
    text-name: "[nom]";
    text-size: 9;
    text-fill: pink;
    text-face-name: @bold-fonts;
    text-halo-radius: 1;
    text-wrap-width: 40;
    text-avoid-edges: true;
  }

  [power = 'plant']::power {
    [zoom >= 17] { text-name: "[name]"; }
    text-name: "[nom]";
    text-size: 10;
    text-face-name: @book-fonts;
    text-halo-radius: 1;
    text-wrap-width: 60;
    text-avoid-edges: true;
  }


  // zoom 13

  [zoom >= 13]::natural {
    [natural =~ '(saddle|peak|volcano|mountain_pass)'] {
      marker-width: 3;
      marker-height: 3;
      marker-fill: brown;
      marker-line-width: 0;
      marker-placement: interior;
      long/text-name: "[name]";
      long/text-size: 10;
      long/text-fill: brown;
      long/text-dy: 5;
      long/text-face-name: @book-fonts;
      long/text-halo-radius: 1;
      long/text-avoid-edges: true;
      short/text-name: "[nom]";
      short/text-size: 10;
      short/text-fill: brown;
      short/text-dy: 5;
      short/text-face-name: @book-fonts;
      short/text-halo-radius: 1;
      short/text-avoid-edges: true;
      [ele!=''] {
        ele/text-name: "[ele]";
        ele/text-size: 9;
        ele/text-fill: brown;
        ele/text-dy: 5;
        ele/text-face-name: @oblique-fonts;
        ele/text-halo-radius: 1;
        ele/text-avoid-edges: true;
        [ele!=''][name != ''] {
          ele/text-dy: 18;
        }
      }
    }
  }

  // zoom 14

  [zoom >= 14] {
    [leisure = 'golf_course']::leisure {
      [zoom >= 17] { text-name: "[name]"; }
      text-name: "[nom]";
      text-size: 10;
      text-fill: #060;
      text-face-name: @book-fonts;
      text-halo-radius: 1;
      text-wrap-width: 40;
      text-avoid-edges: true;
      text-dy: 12;
      [zoom >= 16] {
        text-size: 12;
        text-fill: grey;
        text-face-name: @oblique-fonts;
        text-dy: 0;
      }
      // variation de la texte du texte en fonction de la surface du polygone
      [pixels>20] {
        text-size: 12;
        text-wrap-width: 50;
      }
      [pixels>100] {
        text-size: 14;
        text-wrap-width: 60;
      }
    }

    [tourism='zoo']::tourism,
    [tourism='theme_park']::tourism {
      [zoom >= 17] { text-name: "[name]"; }
      text-name: "[nom]";
      text-size: 9;
      text-fill: #734a08;
      text-face-name: @book-fonts;
      text-halo-radius: 1;
      text-wrap-width: 30;
      text-avoid-edges: true;
      [zoom >= 16] {
        text-size: 10;
      }
      // variation de la texte du texte en fonction de la surface du polygone
      [pixels>20] {
        text-size: 12;
      }
      [pixels>100] {
        text-size: 14;
      }
    }
  }
}

#poi-text [zoom >= 15] {


  // zoom 15

  [feature = 'amenity_place_of_worship'] {
    [heritage = '1'][zoom >= 15],
    [zoom >= 17],
    [pixels>1000] {
      [zoom >= 17] { text-name: "[name]"; }
      text-name: "[nom]";
      text-size: 10;
      text-fill: #000033;
      text-dy: 11;
      text-face-name: @book-fonts;
      text-halo-radius: 1;
      text-wrap-width: 40;
      text-avoid-edges: true;
      [heritage != ''] {
        text-face-name: @bold-fonts;
        text-fill: #734a08;
      }
      // variation de la taille du texte en fonction de la surface du polygone (en pixels)
      [pixels > 5000] { text-size: 12; }
    }
  }


  [feature = 'natural_wood'] {
    [zoom >= 17] { text-name: "[name]"; }
    text-name: "[nom]";
    text-fill: #060;
    text-face-name: @oblique-fonts;
    text-halo-radius: 2;
    text-halo-fill: fadeout(white, 30%);
    text-wrap-width: 40;
    text-avoid-edges: true;

    // variation de la texte du texte en fonction de la surface du polygone
    text-size: 10;
    [pixels > 5000] {
      text-size: 12;
      text-label-position-tolerance: 8;
      text-wrap-width: 50;
    }
    [pixels > 20000] {
      text-size: 14;
      text-label-position-tolerance: 10;
      text-wrap-width: 60;
    }
  }

  [feature = 'natural_cave_entrance'] {
    [zoom >= 17] { text-name: "[name]"; }
    text-name: "[nom]";
    text-size: 10;
    text-fill: brown;
    text-dy: 9;
    text-face-name: @book-fonts;
    text-halo-radius: 1;
    text-wrap-width: 40;
    text-avoid-edges: true;
  }

  [feature = 'historic_castle'],
  [feature = 'historic_manor'] {
    [zoom >= 17] { text-name: "[name]"; }
    text-name: "[nom]";
    text-size: 9;
    text-fill: #734a08;
    text-dy: 9;
    text-face-name: @book-fonts;
    text-halo-radius: 1;
    text-wrap-width: 40;
    text-avoid-edges: true;
    [zoom >= 19] {
      text-size: 10;
      text-dy: 10;
    }
  }

  [feature = 'natural_lake'],
  [feature = 'landuse_reservoir'],
  [feature = 'landuse_basin'] {
    [zoom >= 17] { text-name: "[name]"; }
    text-name: "[nom]";
    text-size: 10;
    text-fill: #6699cc;
    text-face-name: @book-fonts;
    text-halo-radius: 1;
    text-wrap-width: 40;
    text-avoid-edges: true;
    // variation de la texte du texte en fonction de la surface du polygone
    [pixels > 5000] {
      text-size: 12;
      text-wrap-width: 50;
    }
    [pixels > 20000] {
      text-size: 14;
      text-wrap-width: 60;
    }
  }

  [feature = 'tourism_alpine_hut'] {
    [zoom >= 17] { text-name: "[name]"; }
	  text-name: "[nom]";
    text-size: 9;
    text-fill: #6699cc;
    text-dy: 10;
    text-face-name: @book-fonts;
    text-halo-radius: 1;
    text-avoid-edges: true;
    [zoom >= 16] {
      ele/text-name: "[ele]";
      ele/text-size: 8;
      ele/text-fill: #6699cc;
      ele/text-dy: 22;
      ele/text-face-name: @oblique-fonts;
      ele/text-halo-radius: 1;
      ele/text-avoid-edges: true;
    }
  }

  [feature = 'amenity_townhall'] {
    [zoom >= 17] { text-name: "[name]"; }
	  text-name: "[nom]";
    text-size: 10;
    text-fill: #666;
    text-wrap-width: 40;
    text-face-name: @bold-fonts;
    text-halo-radius: 1;
    text-avoid-edges: true;
    text-dy: 12;
  }

  [feature = 'amenity_university'] {
    [zoom >= 17] { text-name: "[name]"; }
    text-name: "[nom]";
    text-size: 9;
    text-fill: #000033;
    text-face-name: @book-fonts;
    text-halo-radius: 2;
    text-avoid-edges: true;
    text-wrap-width: 40;
  }

  [feature = 'amenity_kindergarten'],
  [feature = 'amenity_school'],
  [feature = 'amenity_college'] {
    text-name: "[nom]";
    text-fill: #440;
    text-face-name: @book-fonts;
    text-halo-radius: 1.5;
    text-avoid-edges: true;
    [name =~ '^Section.*']{ text-name: "";} // pas de rendu des "Section d'enseignement..."
    [zoom=15] {
      [ecole != '']
      {
        text-name: "[ecole]";
        text-wrap-width: 0;
      }
    }
    text-size: 9;
    text-wrap-width: 30;
    [pixels > 5000] {
      text-name: "[name]";
      text-size: 11;
      text-wrap-width: 40;
    }
  }

  /* affichage du nom court si il n'y avait pas la place pour le nom complet */
  [feature = 'amenity_kindergarten']::school2,
  [feature = 'amenity_school']::school2,
  [feature = 'amenity_college']::school2 {
    [ecole != ''] {
      text-name: "[nom]";
      [ecole =~ '^Section.*']{ text-name: "";} // pas de rendu des "Section d'enseignement..."
      [pixels > 5000] {
        text-size: 11;
        text-wrap-width: 60;
      }
      text-fill: #440;
      text-face-name: @book-fonts;
      text-halo-radius: 1.5;
      text-wrap-width: 40;
      text-avoid-edges: true;
    }
  }

	/* affichage du nom générique si il n'y avait pas la place pour le nom complet ou court */
  [feature = 'amenity_kindergarten']::school3,
  [feature = 'amenity_school']::school3,
  [feature = 'amenity_college']::school3 {
    [ecole != ''] {
      text-name: "[ecole]";
      [ecole =~ '^Section.*']{ text-name: "";} // pas de rendu des "Section d'enseignement..."
      [pixels > 5000] {
        text-size: 11;
        text-wrap-width: 60;
      }
      text-fill: #440;
      text-face-name: @book-fonts;
      text-halo-radius: 1.5;
      text-wrap-width: 40;
      text-avoid-edges: true;
    }
  }

  [feature = 'manmade_lighthouse'] {
    text-name: "[name]";
    text-size: 9;
    text-fill: #000033;
    text-dy: 16;
    text-face-name: @book-fonts;
    text-halo-radius: 2;
    text-avoid-edges: true;
    text-wrap-width: 40;
  }

  [feature = 'amenity_clinic'],
  [feature = 'amenity_hospital'] {
    long/text-name: "[name]";
    long/text-fill: @health-color;
    long/text-size: 9;
    long/text-dy: 12;
    long/text-face-name: @book-fonts;
    long/text-halo-radius: 2;
    long/text-wrap-width: 40;
    long/text-avoid-edges: true;
    [pixels > 5000] {
      long/text-size: 12;
      long/text-wrap-width: 60;
    }

    short/text-name: "[nom]";
    short/text-fill: @health-color;
    short/text-size: 9;
    short/text-dy: 12;
    short/text-face-name: @book-fonts;
    short/text-halo-radius: 2;
    short/text-wrap-width: 40;
    short/text-avoid-edges: true;
    [pixels > 5000] {
      short/text-size: 12;
      short/text-wrap-width: 60;
    }
  }

  [feature = 'waterway_lock'] {
    text-name: "[name]";
    text-size: 9;
    text-dy: 10;
    text-fill: #0066ff;
    text-face-name: @book-fonts;
    text-halo-radius: 1;
    text-wrap-width: 70;
  }

  // zoom 16

  [feature = 'amenity_library'],
  [feature = 'amenity_theatre'] {
    [zoom<17] { text-name: "[nom]"; }
    text-name: "[name]";
    text-size: 11;
    text-fill: #734a08;
    text-dy: 12;
    text-face-name: @book-fonts;
    text-halo-radius: 1;
    text-avoid-edges: true;
    text-wrap-width: 40;
    // variation de la texte du texte en fonction de la surface du polygone
    [pixels>5000] {
      text-size: 12;
    }
    [pixels>20000] {
      text-size: 14;
    }
  }

  [feature = 'natural_spring'][zoom >= 16] {
    text-name: "[name]";
    text-size: 10;
    text-fill: #6699cc;
    text-face-name: @book-fonts;
    text-halo-radius: 1;
    text-wrap-width: 40;
    text-avoid-edges: true;
  }

  [feature = 'amenity_public_building'],
  [feature = 'amenity_community_centre'],
  [feature = 'amenity_social_facility'],
  [feature = 'amenity_courthouse'] {
    [zoom >= 16],
    [pixels>1000] {
      text-name: "[name]";
      text-size: 10;
      text-fill: #666;
      text-wrap-width: 40;
      text-face-name: @bold-fonts;
      text-halo-radius: 1;
      text-avoid-edges: true;
      [feature = 'amenity_courthouse'] { text-dy: 12; }
    }
  }

  [feature = 'tourism_attraction'],
  [feature = 'tourism_museum'] {
    [zoom>=16],
    [pixels>1000] {
      text-name: "[name]";
      text-size: 10;
      text-dy: 10;
      text-fill: #734a08;
      text-face-name: @bold-fonts;
      text-halo-radius: 1;
      text-wrap-width: 70;
      text-avoid-edges: true;
      // variation de la texte du texte en fonction de la surface du polygone
      [pixels>5000]  { text-size: 12; }
      [pixels>20000] { text-size: 14; }
    }
  }

  [feature = 'information_guidepost'][zoom>=17]
  {
    text-name: "[name]";
    text-size: 9;
    text-dy: 10;
    text-face-name: @book-fonts;
    text-wrap-width: 40;
    text-avoid-edges: true;
    text-halo-radius: 1;
    ele/text-name: "[ele]";
    ele/text-size: 9;
    ele/text-dy: 21;
    ele/text-face-name: @oblique-fonts;
    ele/text-wrap-width: 40;
    ele/text-avoid-edges: true;
  }

  [feature = 'shop_mall'],
  [feature = 'shop_department_store'] {
    [zoom >= 16],
    [pixels>1000] {
      text-name: "[nom]";
      text-size: 11;
      text-dy: 14;
      text-fill: #939;
      text-face-name: @book-fonts;
      text-halo-radius: 1.25;
      text-wrap-width: 30;
      text-avoid-edges: true;
      [zoom >= 19] {
        text-name: "[name]";
        text-wrap-width: 40;
      }
    }
  }

  [feature = 'shop_supermarket'] {
    [zoom >= 16],
    [pixels>1000] {
      text-name: "[nom]";
      text-size: 9;
      text-dy: 11;
      text-fill: #939;
      text-face-name: @book-fonts;
      text-halo-radius: 1;
      text-wrap-width: 30;
      text-avoid-edges: true;
    }
    [zoom >= 19] {
      text-name: "[name]";
      text-size: 11;
      text-dy: 12;
      text-fill: #939;
      text-face-name: @book-fonts;
      text-halo-radius: 1;
      text-wrap-width: 40;
      text-avoid-edges: true;
    }
  }


  // zoom 17

  [feature = 'leisure_fitness_station'],
  [feature = 'amenity_vehicle_inspection'],
  [feature = 'amenity_car_wash'],
  [feature = 'amenity_marketplace'],
  [shop != ''][shop != 'vacant'][shop != 'supermarket'][shop != 'mall'][shop != 'department_store']::shop {
		[zoom >= 17],
    [pixels>1000] {
			text-name: "[name]";
			text-size: 9;
			text-fill: #939;
			text-face-name: @book-fonts;
			text-halo-radius: 1;
		 	text-wrap-width: 20;
			text-avoid-edges: true;
      text-dy: 7;

      [feature = 'leisure_fitness_station'],
      [feature = 'amenity_vehicle_inspection'],
      [feature = 'amenity_car_wash'],
      [feature = 'amenity_marketplace'],
      [shop = 'bag'],
  		[shop = 'bakery'],
      [shop = 'beauty'],
  		[shop = 'beverages'],
  		[shop = 'bicycle'],
      [shop = 'books'],
			[shop = 'boutique'],
  		[shop = 'butcher'],
			[shop = 'car'],
      [shop = 'car_parts'],
      [shop = 'car_repair'],
			[shop = 'clothes'],
			[shop = 'confectionery'],
      [shop = 'chocolate'],
			[shop = 'convenience'],
  		[shop = 'computer'],
			[shop = 'copyshop'],
			[shop = 'doityourself'],
			[shop = 'dry_cleaning'],
      [shop = 'electronics'],
  		[shop = 'fishmonger'],
      [shop = 'florist'],
      [shop = 'frozen_food'],
      [shop = 'funeral_directors'],
  		[shop = 'garden_centre'],
      [shop = 'gift'],
			[shop = 'greengrocer'],
			[shop = 'hifi'],
      [shop = 'ice_cream'],
			[shop = 'jewelry'],
			[shop = 'laundry'],
      [shop = 'medical_supply'],
			[shop = 'motorcycle'],
			[shop = 'musical_instrument'],
      [shop = 'newsagent'],
  		[shop = 'optician'],
      [shop = 'perfumery'],
			[shop = 'photo_studio'],
			[shop = 'photo'],
  		[shop = 'seafood'],
  		[shop = 'shoes'],
      [shop = 'sports'],
      [shop = 'telephone'],
  		[shop = 'toys'],
      [shop = 'tyres'],
      [shop = 'video_games'],
      [shop = 'variety_store'],
      [shop = 'pet'],
      [shop = 'paint'],
      [shop = 'stationery'],
      [shop = 'bed'],
      [shop = 'trade'],
      [shop = 'coffee'],
      [shop = 'interior_decoration'] {
				text-dy: 9;
			}

  		[shop = 'furniture'],
  		[shop = 'hairdresser'],
			[shop = 'mobile_phone'],
			[shop = 'travel_agency'] {
				text-dy: 10;
			}

	  	[shop = 'alcohol'] {
				text-dy: 12;
			}
	  }
  }

  [feature = 'amenity_car_rental'],
  [feature = 'amenity_parking'] {
    [zoom>=17],
    [pixels>1000] {
      text-name: "[name]";
      text-size: 9;
      text-fill: @transport;
      text-dy: 9;
      text-face-name: @book-fonts;
      text-halo-radius: 1;
      text-wrap-width: 40;
      text-avoid-edges: true;
      [zoom >= 19] {
        text-size: 10;
        text-dy: 10;
      }
    }
  }

  [feature = 'amenity_embassy'][zoom >= 17] {
    text-name: "[name]";
    text-size: 9;
    text-fill: #0066ff;
    text-dy: 10;
    text-face-name: @book-fonts;
    text-halo-radius: 1;
    text-avoid-edges: true;
    text-wrap-width: 60;
	  [zoom >= 19] {
		text-size: 10;
		text-dy: 11;
	  }
  }

  [feature = 'amenity_police'][zoom >= 17],
  [feature = 'amenity_fire_station'][zoom >= 17] {
    text-name: "[name]";
    text-size: 10;
    text-fill: #734a08;
    text-dy: 10;
    text-face-name: @book-fonts;
    text-halo-radius: 1;
    text-wrap-width: 40;
    text-avoid-edges: true;
    // variation de la texte du texte en fonction de la surface du polygone
    [pixels>5000] {
      text-size: 12;
    }
    [pixels>20000] {
      text-size: 14;
    }
  }
  [feature = 'historic_memorial'][zoom >= 17],
  [feature = 'historic_archaeological_site'][zoom >= 17],
  [feature = 'historic_tomb'][zoom >= 18],
  [feature = 'historic_grave'][zoom >= 18]
  {
    text-name: "[name]";
    text-size: 9;
    text-fill: #734a08;
    text-dy: 12;
    text-face-name: @book-fonts;
    text-halo-radius: 1;
    text-wrap-width: 40;
    text-avoid-edges: true;
    [zoom >= 19] {
      text-size: 10;
      text-dy: 13;
    }
  }

  [feature = 'amenity_shelter'][zoom >= 17] {
    text-name: "[name]";
    text-size: 9;
    text-fill: #6699cc;
    text-dy: 10;
    text-face-name: @book-fonts;
    text-halo-radius: 1;
    text-avoid-edges: true;
    ele/text-name: "[ele]";
    ele/text-size: 8;
    ele/text-fill: #6699cc;
    ele/text-dy: 22;
    ele/text-face-name: @oblique-fonts;
    ele/text-halo-radius: 1;
    ele/text-avoid-edges: true;
  }

  [feature = 'amenity_prison'][zoom >= 17] {
    text-name: "[name]";
    text-size: 10;
    text-fill: #734a08;
    text-dy: 16;
    text-face-name: @book-fonts;
    text-halo-radius: 1;
    text-avoid-edges: true;
    text-wrap-width: 40;
  }

  [feature = 'manmade_windmill'][zoom >= 17] {
    text-name: "[name]";
    text-size: 9;
    text-fill: #734a08;
    text-dy: 12;
    text-face-name: @book-fonts;
    text-halo-radius: 1;
    text-avoid-edges: true;
    text-wrap-width: 40;
  }

 [feature = 'amenity_recycling'][zoom >= 17] {
   text-name: "[name]";
   text-size: 9;
   text-face-name: @book-fonts;
   text-halo-radius: 1;
   text-wrap-width: 40;
   text-avoid-edges: true;
   text-dy: 8;
 }

  [feature = 'amenity_restaurant'][zoom >= 17] {
      text-name: "[name]";
      text-fill: #734a08;
      text-size: 10;
      text-dy: 9;
      text-face-name: @book-fonts;
      text-halo-radius: 1;
      text-wrap-width: 40;
      text-avoid-edges: true;
  }

  [feature = 'amenity_pub'],
  [feature = 'amenity_cafe'],
  [feature = 'amenity_fast_food'],
  [feature = 'amenity_beirgarten'],
  [feature = 'amenity_bar'] {
    [zoom >= 17] {
      text-name: "[name]";
      text-fill: #734a08;
      text-size: 9;
      text-dy: 9;
      text-face-name: @book-fonts;
      text-halo-radius: 1;
      text-wrap-width: 40;
      text-avoid-edges: true;
  	  [zoom >= 19] {
    		text-size: 10;
    		text-dy: 10;
  	  }
      [feature = 'amenity_bar'] {text-dy: 12;}
    }
  }

  [feature = 'amenity_cinema'][zoom >= 17] {
    text-name: "[name]";
    text-size: 10;
    text-fill: #734a08;
    text-dy: 14;
    text-face-name: @bold-fonts;
    text-halo-radius: 1;
    text-avoid-edges: true;
    text-wrap-width: 40;
    // variation de la texte du texte en fonction de la surface du polygone
    [pixels>5000]  { text-size: 12; }
    [pixels>20000] { text-size: 14; }
  }

  [feature = 'amenity_bank'][zoom >= 17] {
    text-name: "[name]";
    text-size: 9;
    text-fill: @brown-poi;
    text-dy: 9;
    text-halo-radius: 1;
    text-avoid-edges: true;
    text-face-name: @book-fonts;
    text-wrap-width: 40;
	  [zoom >= 19] {
		text-size: 10;
		text-dy: 10;
	  }
  }

  [feature = 'tourism_hotel'][zoom >= 17] {
      text-name: "[name]+'\n'+[stars]";
      text-size: 10;
      text-fill: #0066ff;
      text-dy: 8;
      text-face-name: @book-fonts;
      text-halo-radius: 1;
      text-avoid-edges: true;
      text-wrap-width: 60;
  }

  [feature = 'tourism_hostel'],
  [feature = 'tourism_chalet'] {
    [zoom >= 17] {
      text-name: "[name]+'\n'+[stars]";
      text-size: 10;
      text-fill: #0066ff;
      text-dy: 11;
      text-face-name: @book-fonts;
      text-halo-radius: 1;
      text-avoid-edges: true;
      text-wrap-width: 60;
    }
  }

  [feature = 'tourism_guest_house'][zoom >= 17] {
    text-name: "[name]";
    text-size: 9;
    text-fill: #0066ff;
    text-dy: 9;
    text-face-name: @book-fonts;
    text-halo-radius: 1;
    text-avoid-edges: true;
    text-wrap-width: 40;
	  [zoom >= 19] {
  		text-size: 10;
  		text-dy: 10;
  	  }
  }

  [feature = 'tourism_bed_and_breakfast'][zoom >= 17] {
    text-name: "[name]";
    text-size: 9;
    text-fill: #0066ff;
    text-dy: 9;
    text-face-name: @book-fonts;
    text-halo-radius: 1;
    text-avoid-edges: true;
    text-wrap-width: 40;
	  [zoom >= 19] {
  		text-size: 10;
  		text-dy: 10;
  	  }
  }

  [feature = 'amenity_fuel'][zoom >= 17] {
      text-name: "[name]";
      text-size: 9;
      text-fill: #0066ff;
      text-dy: 9;
      text-face-name: @book-fonts;
      text-halo-radius: 1;
      text-wrap-width: 40;
  	  [zoom >= 19] {
    		text-size: 10;
    		text-dy: 10;
    	  }
  }

  [feature = 'tourism_camp_site'][zoom >= 17] {
    text-name: "[name]";
    text-size: 10;
    text-fill: #0066ff;
    text-dy: 15;
    text-face-name: @book-fonts;
    text-halo-radius: 1;
    text-wrap-width: 60;
    // variation de la texte du texte en fonction de la surface du polygone
    [pixels>5000] {
      text-size: 12;
      text-wrap-width: 70;
    }
    [pixels>20000] {
      text-size: 14;
      text-wrap-width: 80;
    }
  }

  [feature = 'tourism_caravan_site'][zoom >= 17] {
    text-name: "[name]";
    text-size: 10;
    text-fill: #0066ff;
    text-dy: 19;
    text-face-name: @book-fonts;
    text-halo-radius: 1;
    text-wrap-width: 60;
    // variation de la texte du texte en fonction de la surface du polygone
    [pixels>5000] {
      text-size: 12;
      text-wrap-width: 70;
    }
    [pixels>20000] {
      text-size: 14;
      text-wrap-width: 80;
    }
  }

  [feature = 'amenity_pharmacy'][zoom >= 17] {
    text-name: "[name]";
    text-size: 9;
    text-dy: 12;
    text-fill: #008800;
    text-face-name: @book-fonts;
    text-halo-radius: 1;
    text-wrap-width: 40;
    text-avoid-edges: true;
  }

  // potentially larger offices
  [feature = 'office_administrative'],
  [feature = 'office_adoption_agency'],
  [feature = 'office_educational_institution'],
  [feature = 'office_employment_agency'],
  [feature = 'office_energy_supplier'],
  [feature = 'office_financial'],
  [feature = 'office_government'],
  [feature = 'office_newspaper'],
  [feature = 'office_ngo'],
  [feature = 'office_political_party'],
  [feature =  'office_quango'],
  [feature = 'office_religion'],
  [feature = 'office_research'],
  [feature = 'office_tax'],
  [feature = 'office_telecommunication'],
  [feature = 'office_water_utility'],
  {
    text-name: "[name]";
    text-size: 10;
    text-dy: 4;
    text-face-name: @book-fonts;
    text-halo-radius: 1;
    text-wrap-width: 40;
    text-avoid-edges: true;
    text-fill: @office;
  }

  // crafts
  [healthcare = null][club = null][craft != null][craft != 'vacant'][pixels >= @poi_min_pixels]::other,
  [healthcare = null][club = null][craft != null][craft != 'vacant'][zoom >= 17]::other {
      text-name: "[name]";
      text-size: 9;
      text-face-name: @book-fonts;
      text-halo-radius: 1;
      text-wrap-width: 40;
      text-avoid-edges: true;
      text-dy: 4;
      text-fill: @office;
  }

  [craft = null][club = null][healthcare != null][healthcare != 'vacant']::other {
    [pixels >= @poi_min_pixels],
    [zoom >= 17] {
      text-name: "[name]";
      text-size: 9;
      text-face-name: @book-fonts;
      text-halo-radius: 1;
      text-wrap-width: 40;
      text-avoid-edges: true;
      text-dy: 4;
      text-fill: @health-color;
    }
  }

  // club
  [craft = null][healthcare = null][club != null]::other {
    [pixels >= @poi_min_pixels],
    [zoom >= 17] {
      text-name: "[name]";
      text-size: 9;
      text-face-name: @book-fonts;
      text-halo-radius: 1;
      text-wrap-width: 40;
      text-avoid-edges: true;
      text-fill: black;
    }
  }

  [feature = 'aeroway_gate'][zoom >= 17] {
    text-name: "[ref]";
    text-size: 9;
    text-fill: #aa66cc;
    text-face-name: @bold-fonts;
    text-halo-radius: 1;
    text-wrap-width: 40;
    text-avoid-edges: true;
    [zoom >= 18] {  text-size: 12; }
  }


  // zoom 18

  [pixels >= @poi_min_pixels],
  [zoom >= 18] {
    // other documented office types
    [feature = 'office_accountant'],
    [feature = 'office_advertising_agency'],
    [feature = 'office_architect'],
    [feature = 'office_association'],
    [feature = 'office_charity'],
    [feature = 'office_company'],
    [feature = 'office_estate_agent'],
    [feature = 'office_forestry'],
    [feature = 'office_foundation'],
    [feature = 'office_guide'],
    [feature = 'office_insurance'],
    [feature = 'office_it'],
    [feature = 'office_lawyer'],
    [feature = 'office_logistics'],
    [feature = 'office_moving_company'],
    [feature = 'office_notary'],
    [feature = 'office_physician'],
    [feature = 'office_private_investigator'],
    [feature = 'office_property_management'],
    [feature = 'office_surveyor'],
    [feature = 'office_tax_advisor'],
    [feature = 'office_therapist'],
    [feature = 'office_travel_agent'] {
      text-name: "[name]";
      text-size: 9;
      text-face-name: @book-fonts;
      text-halo-radius: 1;
      text-wrap-width: 40;
      text-avoid-edges: true;
      text-dy: 4;
      text-fill: @office;
    }
  }

  [pixels >= @poi_min_pixels],
  [zoom >= 18] {
    [feature = 'tourism_artwork'] {
      text-name: "[name]";
      text-size: 9;
      text-face-name: @book-fonts;
      text-halo-radius: 1;
      text-wrap-width: 40;
      text-avoid-edges: true;
      text-dy: 9;
      text-fill: @brown-poi;
    }
  }

  [pixels >= @poi_min_pixels],
  [zoom >= 18] {
    [feature = 'leisure_outdoor_seating'] {
      text-name: "[name]";
      text-size: 9;
      text-face-name: @book-fonts;
      text-halo-radius: 1;
      text-wrap-width: 40;
      text-avoid-edges: true;
      text-dy: 9;
      text-fill: #060;
    }
  }


  ::other {
    // all other offices
    [craft= null][healthcare = null][club = null][office != null][office != 'vacant'][zoom >= 19] {
      text-name: "[name]";
      text-size: 10;
      text-face-name: @book-fonts;
      text-halo-radius: 1;
      text-wrap-width: 40;
      text-avoid-edges: true;
      text-dy: 4;
      text-fill: @office;
    }
  }

}

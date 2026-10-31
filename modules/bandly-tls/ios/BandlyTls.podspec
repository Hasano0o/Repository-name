Pod::Spec.new do |s|
  s.name           = 'BandlyTls'
  s.version        = '1.0.0'
  s.summary        = 'Bandly: accept self-signed router certificates on local addresses only'
  s.description    = 'Adds a server-trust handler to React Native networking that accepts self-signed certificates only for private LAN hosts (routers).'
  s.author         = 'Hasano0o'
  s.homepage       = 'https://has-host.com'
  s.license        = { :type => 'MIT' }
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.{m,swift}'
end
